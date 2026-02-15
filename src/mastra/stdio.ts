import { MCPServer } from '@mastra/mcp';
import { allTools } from '../tools';

const server = new MCPServer({
  name: 'kibana-banking-mcp-server',
  version: '1.0.0',
  tools: allTools,
});

server.startStdio().catch((error) => {
  process.stderr.write(`Error running MCP server: ${error}\n`);
  process.exit(1);
});
