mod mcp;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::Value;
use tauri::State;
use tauri::Manager;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;
use rmcp::model::CallToolRequestParam;

struct McpState {
    clients: Mutex<HashMap<String, Arc<mcp::McpClient>>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn mcp_connect(
    state: State<'_, McpState>,
    id: String,
    url: String,
    transport: Option<String>,
) -> Result<(), String> {
    // Use provided transport or heuristic
    let transport_type = match transport.as_deref() {
        Some("sse") => mcp::TransportType::Sse,
        Some("http") => mcp::TransportType::StreamableHttp,
        _ => if url.contains("/sse") {
            mcp::TransportType::Sse
        } else {
            mcp::TransportType::StreamableHttp
        }
    };

    let client = mcp::connect(&url, transport_type).await.map_err(|e| e.to_string())?;
    
    state.clients.lock().await.insert(id, Arc::new(client));
    Ok(())
}

#[tauri::command]
async fn mcp_list_tools(
    state: State<'_, McpState>,
    id: String,
) -> Result<Value, String> {
    let clients = state.clients.lock().await;
    let client = clients.get(&id).ok_or("Client not found")?;
    
    let result = client.list_tools(Default::default()).await.map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
async fn mcp_call_tool(
    state: State<'_, McpState>,
    id: String,
    name: String,
    args: Value,
) -> Result<Value, String> {
    let clients = state.clients.lock().await;
    let client = clients.get(&id).ok_or("Client not found")?;
    
    let param = CallToolRequestParam {
        name: name.into(),
        arguments: args.as_object().cloned(),
    };

    let result = client.call_tool(param).await.map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .manage(McpState {
            clients: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");

            #[cfg(target_os = "windows")]
            apply_mica(&window, None)
                .expect("Unsupported platform! 'apply_mica' is only supported on Windows");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            mcp_connect,
            mcp_list_tools,
            mcp_call_tool
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
