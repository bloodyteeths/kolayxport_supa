import React from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button'; // Assuming you have a Button component from shadcn/ui
import { Inbox } from 'lucide-react'; // Default icon
import { useTranslations } from 'next-intl';

const EmptyState = ({
  icon: IconComponent = Inbox,
  imageSrc,
  imageAlt = 'Empty state illustration',
  imageWidth = 200,
  imageHeight = 200,
  title,
  message,
  actionText,
  onActionClick,
  className = ''
}) => {
  const t = useTranslations('errors');
  const resolvedTitle = title ?? t('noItemsTitle');
  const resolvedMessage = message ?? t('noItemsMessage');

  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 bg-white rounded-lg shadow-sm ${className}`}>
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={imageWidth}
          height={imageHeight}
          className="mb-6 opacity-75"
        />
      ) : (
        IconComponent && <IconComponent className="w-16 h-16 text-gray-400 mb-6" strokeWidth={1.5} />
      )}
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{resolvedTitle}</h2>
      <p className="text-gray-500 max-w-md mb-6">{resolvedMessage}</p>
      {actionText && onActionClick && (
        <Button onClick={onActionClick}>
          {actionText}
        </Button>
      )}
    </div>
  );
};

export default EmptyState; 