export {};

declare global {
  interface Window {
    bulletsDesktop?: {
      notifications: {
        isSupported(): Promise<boolean>;
        schedule(notifications: Array<{
          id: number;
          title: string;
          body: string;
          route: string;
          at: number;
        }>): Promise<void>;
      };
      onRoute(listener: (route: string) => void): () => void;
    };
  }
}
