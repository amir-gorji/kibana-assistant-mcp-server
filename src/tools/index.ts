import { kibanaSearchTool } from './kibanaSearch';
import { discoverClusterTool } from './discoverCluster';
import { checkClusterHealthTool } from './checkClusterHealth';
import { getAlertStatusTool } from './getAlertStatus';

export const allTools = {
  discoverClusterTool,
  kibanaSearchTool,
  checkClusterHealthTool,
  getAlertStatusTool,
};
