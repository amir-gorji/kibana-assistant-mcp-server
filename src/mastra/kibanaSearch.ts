import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import { z } from 'zod';

const KIBANA_URL = process.env.KIBANA_URL || 'http://localhost:5601';
const KIBANA_API_KEY = process.env.KIBANA_API_KEY;

export const kibanaSearchTool = createTool({
  id: 'kibana_search',
  description:
    'Execute a DSL query against a Kibana index to retrieve logs or data.',
  inputSchema: z.object({
    index: z.string().describe('The index pattern to search (e.g., "logs-*")'),
    query: z.record(z.any()).describe('The Elasticsearch DSL query object'),
    size: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results to return'),
  }),
  execute: async ({ index, query, size }) => {
    try {
      // Kibana URL -> Elasticsearch URL : Elastic Cloud
      const esUrl = KIBANA_URL.replace(/\.kb\./, '.es.');

      const response = await axios.post(
        `${esUrl}/${index}/_search`,
        {
          ...query,
          size,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `ApiKey ${KIBANA_API_KEY}`,
          },
        },
      );

      return {
        data: response.data.hits.hits.map((hit: any) => hit._source),
        total: response.data.hits.total.value,
        aggregations: response.data.aggregations,
      };
    } catch (error: any) {
      return {
        error: error.response?.data || error.message,
        status: 'failed',
      };
    }
  },
});
