import {
  defineEnvironmentExtensionApi,
  readEnvironmentProductManifest,
  type ExperimentalEnvironmentExtensionApiFactory,
} from "../../../apps/web/src/extensionApi.ts";
import {
  createTasksWebRpcClient,
  resolveTasksWebAccess,
  type TasksWsRpcProtocolClient,
  type TasksWebRpcClient,
} from "./rpc/index.ts";

export const TASKS_WEB_ENVIRONMENT_API = defineEnvironmentExtensionApi<TasksWebRpcClient>(
  "upcomputer.tasks.web-rpc",
);

export const TASKS_WEB_ENVIRONMENT_API_FACTORY = {
  definition: TASKS_WEB_ENVIRONMENT_API,
  create: ({ environmentId, request }) =>
    createTasksWebRpcClient(request, {
      getAccess: () => {
        const manifest = readEnvironmentProductManifest(environmentId);
        return resolveTasksWebAccess({
          manifest,
          metadataStatus: manifest === undefined ? "loading" : "ready",
        });
      },
    }),
} satisfies ExperimentalEnvironmentExtensionApiFactory<TasksWsRpcProtocolClient, TasksWebRpcClient>;
