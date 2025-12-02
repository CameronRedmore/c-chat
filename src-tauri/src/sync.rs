use tauri::{State, AppHandle, Emitter};
use axum::{
    routing::get,
    Router,
    Json,
    extract::{State as AxumState},
    http::{StatusCode, Method},
};
use tower_http::cors::{Any, CorsLayer};
use std::sync::{Arc, Mutex};
use local_ip_address::local_ip;
use tokio::sync::oneshot;

pub struct SyncService {
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl SyncService {
    pub fn new() -> Self {
        Self {
            shutdown_tx: Mutex::new(None),
        }
    }
}

#[derive(Clone)]
struct ServerState {
    settings: Arc<Mutex<String>>,
    app_handle: AppHandle,
}

#[tauri::command]
pub async fn start_sync_server(
    app_handle: AppHandle,
    state: State<'_, SyncService>,
    settings: String,
) -> Result<String, String> {
    let rx = {
        let mut shutdown_tx = state.shutdown_tx.lock().map_err(|e| e.to_string())?;
        
        if shutdown_tx.is_some() {
            return Err("Server already running".to_string());
        }

        let (tx, rx) = oneshot::channel();
        *shutdown_tx = Some(tx);
        rx
    };

    let settings_state = ServerState {
        settings: Arc::new(Mutex::new(settings)),
        app_handle: app_handle.clone(),
    };

    let app = Router::new()
        .route("/settings", get(get_settings).post(update_settings))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers(Any),
        )
        .with_state(settings_state);

    let ip = local_ip().map_err(|e| e.to_string())?;
    let listener = tokio::net::TcpListener::bind((ip, 0)).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    
    tauri::async_runtime::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                rx.await.ok();
            })
            .await
            .unwrap();
    });

    Ok(format!("http://{}:{}/settings", ip, port))
}

#[tauri::command]
pub async fn stop_sync_server(state: State<'_, SyncService>) -> Result<(), String> {
    let mut shutdown_tx = state.shutdown_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = shutdown_tx.take() {
        tx.send(()).map_err(|_| "Failed to send shutdown signal".to_string())?;
    }
    Ok(())
}

async fn get_settings(AxumState(state): AxumState<ServerState>) -> Json<serde_json::Value> {
    let settings = state.settings.lock().unwrap();
    let json: serde_json::Value = serde_json::from_str(&settings).unwrap_or(serde_json::json!({}));
    Json(json)
}

async fn update_settings(
    AxumState(state): AxumState<ServerState>,
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    let mut settings = state.settings.lock().unwrap();
    *settings = payload.to_string();
    
    // Notify frontend
    let _ = state.app_handle.emit("sync-settings-received", &payload);
    
    StatusCode::OK
}
