// components/ds/data — data display primitives (DESIGN_SYSTEM §4.4). StatusPill is exported by its owner (M1-a).
export { DataTable, type DataTableProps, type DataTableState } from './DataTable';
export type { Column, ColumnType, DataTablePagination, MobileRole, PageSize, Sort } from './dataTableParts';
export { cellKey, pageList, useColumnVisibility, ColumnsMenu } from './dataTableParts';
export { KpiTile, deltaTone, type KpiTileProps, type KpiDelta } from './KpiTile';
export { Chart, getChartTable, type ChartProps } from './Chart';
export { buildChartOptions, seriesColors, type ChartSeries, type ChartSeriesRole, type ChartFormat, type ChartType } from './chartOptions';
export { ScoreMeter, cellSegments, panelSegments, type ScoreMeterProps } from './ScoreMeter';
export { ScorePanel, type ScorePanelProps } from './ScorePanel';
export { Thumb, type ThumbProps, type ThumbSize } from './Thumb';
export { LogoTile, resolveBrand, tileRadius, type LogoTileProps, type LogoTileSize } from './LogoTile';
export { PlanTag, PlanTagProvider, type PlanTagProps } from './PlanTag';
export { UsageMeter, usageLevel, type UsageMeterProps, type UsageLevel } from './UsageMeter';
export { ShareBar, type ShareBarProps } from './ShareBar';
export { Avatar, initialsOf, type AvatarProps } from './Avatar';
export { KeyValueList, type KeyValueListProps, type KeyValueItem } from './KeyValueList';
export { Timeline, type TimelineProps, type TimelineEvent } from './Timeline';
export type { ActionSpec, BrandKey, CarrierKey, MarketplaceKey, Tone } from './types';
