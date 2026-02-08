import { MCPServer } from '@mastra/mcp';
import { kibanaSearchTool } from './kibanaSearch';

const server = new MCPServer({
  name: 'kibana assistant server',
  version: '0.0.1',
  tools: { kibanaSearchTool },
});

server.startStdio().catch((error) => {
  console.error('Error running MCP server:', error);
  process.exit(1);
});
