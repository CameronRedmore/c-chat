use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::sse_client::SseClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransport;
use rmcp::ServiceExt;

pub enum TransportType {
    Sse,
    StreamableHttp,
}

pub type McpClient = RunningService<RoleClient, ()>;

pub async fn connect(
    url: &str,
    transport_type: TransportType,
) -> Result<McpClient, Box<dyn std::error::Error>> {
    match transport_type {
        TransportType::Sse => {
            let t = SseClientTransport::start(url.to_owned()).await?;
            let service = ().serve(t).await?;
            Ok(service)
        }
        TransportType::StreamableHttp => {
            let t = StreamableHttpClientTransport::from_uri(url);
            let service = ().serve(t).await?;
            Ok(service)
        }
    }
}
