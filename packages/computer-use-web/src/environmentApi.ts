import {
  defineEnvironmentExtensionApi,
  type ExperimentalEnvironmentExtensionApiFactory,
} from "../../../apps/web/src/extensionApi.ts";
import {
  createComputerUseWebRpcClient,
  type ComputerUseWebRpcClient,
  type ComputerUseWsRpcProtocolClient,
} from "./rpc/index.ts";

export const COMPUTER_USE_WEB_ENVIRONMENT_API =
  defineEnvironmentExtensionApi<ComputerUseWebRpcClient>("upcomputer.computer-use.web-rpc");

export const COMPUTER_USE_WEB_ENVIRONMENT_API_FACTORY = {
  definition: COMPUTER_USE_WEB_ENVIRONMENT_API,
  create: ({ request }) => createComputerUseWebRpcClient(request),
} satisfies ExperimentalEnvironmentExtensionApiFactory<
  ComputerUseWsRpcProtocolClient,
  ComputerUseWebRpcClient
>;
