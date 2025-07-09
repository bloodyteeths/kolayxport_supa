declare module 'react-hot-toast' {
  import { ReactNode, CSSProperties, FC } from 'react';

  export interface ToastOptions {
    duration?: number;
    position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    style?: CSSProperties;
    className?: string;
    icon?: string | ReactNode;
    id?: string;
    onClose?: () => void;
  }

  export interface Toast {
    id: string;
    message: string | ReactNode;
    type: 'success' | 'error' | 'loading' | 'blank' | 'custom';
    visible: boolean;
    options: ToastOptions;
  }

  export interface ToasterProps {
    position?: ToastOptions['position'];
    reverseOrder?: boolean;
    toastOptions?: ToastOptions;
    gutter?: number;
    containerStyle?: CSSProperties;
    containerClassName?: string;
  }

  export const toast: {
    (message: string | ReactNode, options?: ToastOptions): string;
    success(message: string | ReactNode, options?: ToastOptions): string;
    error(message: string | ReactNode, options?: ToastOptions): string;
    loading(message: string | ReactNode, options?: ToastOptions): string;
    custom(message: string | ReactNode, options?: ToastOptions): string;
    dismiss(toastId?: string): void;
    remove(toastId?: string): void;
    promise<T>(
      promise: Promise<T>,
      messages: {
        loading: string;
        success: string;
        error: string;
      },
      options?: ToastOptions
    ): Promise<T>;
  };

  export const Toaster: FC<ToasterProps>;
} 