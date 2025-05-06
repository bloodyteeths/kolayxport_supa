import React from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button'; // Assuming you have a Button component from shadcn/ui
import { Inbox } from 'lucide-react'; // Default icon

const EmptyState = ({
  icon: IconComponent = Inbox,
  imageSrc,
  imageAlt = 'Empty state illustration',
  imageWidth = 200,
  imageHeight = 200,
  title = "No items found",
  message = "There are currently no items to display here. Try adjusting your filters or creating a new item.",
  actionText,
  onActionClick,
  className = ''
}) => {
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
      <h2 className="text-xl font-semibold text-gray-700 mb-2">{title}</h2>
      <p className="text-gray-500 max-w-md mb-6">{message}</p>
      {actionText && onActionClick && (
        <Button onClick={onActionClick}>
          {actionText}
        </Button>
      )}
    </div>
  );
};

export default EmptyState; 