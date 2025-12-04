// filepath: /home/blue/codes/omniterm-new/frontend/src/types/mermaid.d.ts
declare module "mermaid" {
  const mermaid: {
    initialize: (config: Record<string, any>) => void;
    render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
  };
  export default mermaid;
}

