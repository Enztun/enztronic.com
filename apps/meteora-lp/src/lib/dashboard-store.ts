import { create } from 'zustand';

export type DashboardTab = 'pnl' | 'decisions' | 'pools' | 'config' | 'setup';

interface DashboardStore {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  botConnected: boolean;
  setBotConnected: (connected: boolean) => void;
  autoRefresh: boolean;
  setAutoRefresh: (enabled: boolean) => void;
  selectedPositionId: string | null;
  setSelectedPositionId: (id: string | null) => void;
  configEditState: Record<string, string | number | boolean>;
  setConfigField: (key: string, value: string | number | boolean) => void;
  resetConfigEdit: () => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  activeTab: 'pnl',
  setActiveTab: (tab) => set({ activeTab: tab }),
  botConnected: true,
  setBotConnected: (connected) => set({ botConnected: connected }),
  autoRefresh: true,
  setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
  selectedPositionId: null,
  setSelectedPositionId: (id) => set({ selectedPositionId: id }),
  configEditState: {},
  setConfigField: (key, value) =>
    set((state) => ({
      configEditState: { ...state.configEditState, [key]: value },
    })),
  resetConfigEdit: () => set({ configEditState: {} }),
}));
