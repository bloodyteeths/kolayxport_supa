import React from 'react';
import {
  Card, CardContent, CardMedia, Typography, Box, Chip, IconButton, Tooltip,
} from '@mui/material';
import { Star, TrendingUp, BookmarkPlus, ExternalLink } from 'lucide-react';
import type { AmazonProductItem } from '@/lib/stores/useAmazonResearchStore';

interface Props {
  product: AmazonProductItem;
  onTrack?: () => void;
}

function confidenceColor(confidence: string) {
  switch (confidence) {
    case 'high': return 'success';
    case 'medium': return 'warning';
    default: return 'default';
  }
}

export default function ProductCard({ product, onTrack }: Props) {
  const { asin, title, imageUrl, price, salesRank, reviewCount, rating, isPrime, salesEstimate, url } = product;

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {imageUrl && (
        <CardMedia
          component="img"
          image={imageUrl}
          alt={title}
          sx={{ height: 160, objectFit: 'contain', p: 1, bgcolor: '#fafafa' }}
        />
      )}

      <CardContent sx={{ flex: 1, py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="body2" fontWeight={600} sx={{
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          mb: 0.5, lineHeight: 1.3, fontSize: '0.8rem',
        }}>
          {title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          {price != null && (
            <Typography variant="subtitle2" fontWeight={700} color="warning.main">
              ${price}
            </Typography>
          )}
          {isPrime && (
            <Chip label="Prime" size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: '#232F3E', color: '#fff' }} />
          )}
        </Box>

        {salesRank && (
          <Typography variant="caption" color="text.secondary" display="block">
            BSR: #{salesRank.toLocaleString()}
          </Typography>
        )}

        {reviewCount != null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
            <Star size={12} fill="#FFB800" stroke="#FFB800" />
            <Typography variant="caption">{rating} ({reviewCount.toLocaleString()})</Typography>
          </Box>
        )}

        {salesEstimate && (
          <Chip
            icon={<TrendingUp size={12} />}
            label={`~${salesEstimate.monthlySales}/mo`}
            size="small"
            color={confidenceColor(salesEstimate.confidence) as any}
            variant="outlined"
            sx={{ mt: 0.5, height: 22, fontSize: '0.7rem' }}
          />
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5, gap: 0.5 }}>
          {url && (
            <Tooltip title="Open on Amazon">
              <IconButton size="small" onClick={() => window.open(url, '_blank')}>
                <ExternalLink size={14} />
              </IconButton>
            </Tooltip>
          )}
          {onTrack && (
            <Tooltip title="Track this product">
              <IconButton size="small" onClick={onTrack} color="warning">
                <BookmarkPlus size={14} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
