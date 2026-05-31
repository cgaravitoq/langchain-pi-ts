import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

let defaults: { authStorage: AuthStorage; registry: ModelRegistry } | undefined;

const getDefaults = () => {
  if (!defaults) {
    const authStorage = AuthStorage.create();
    defaults = { authStorage, registry: ModelRegistry.create(authStorage) };
  }
  return defaults;
};

export const getDefaultRegistry = (): ModelRegistry => getDefaults().registry;

export const getDefaultAuthStorage = (): AuthStorage =>
  getDefaults().authStorage;
