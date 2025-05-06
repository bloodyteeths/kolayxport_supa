import { create } from 'zustand';

const useSidebar = create((set) => ({
  isOpen: true, // Default state
  toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
  openSidebar: () => set({ isOpen: true }),
  closeSidebar: () => set({ isOpen: false }),
}));

export default useSidebar; 