import * as React from 'react';

export function Tabs({ defaultValue, children }) {
  const [activeTab, setActiveTab] = React.useState(defaultValue);

  const context = React.useMemo(() => ({ activeTab, setActiveTab }), [activeTab]);
  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

const TabsContext = React.createContext();

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>');
  return ctx;
}

export function TabsList({ className = '', ...props }) {
  return <div className={`inline-flex gap-2 ${className}`} {...props} />;
}

export function TabsTrigger({ value, children, className = '', ...props }) {
  const { activeTab, setActiveTab } = useTabs();
  const isActive = activeTab === value;
  return (
    <button
      className={`px-3 py-1 rounded-md text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'} ${className}`}
      onClick={() => setActiveTab(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = '', ...props }) {
  const { activeTab } = useTabs();
  if (activeTab !== value) return null;
  return <div className={className} {...props}>{children}</div>;
} 