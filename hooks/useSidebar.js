import { create } from 'zustand';

const useSidebar = create((set) => ({
  isOpen: false, // Default state - collapsed
  toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
  openSidebar: () => set({ isOpen: true }),
  closeSidebar: () => set({ isOpen: false }),
}));

export default useSidebar; 