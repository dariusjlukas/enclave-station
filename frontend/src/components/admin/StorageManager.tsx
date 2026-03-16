import { useState, useEffect, useMemo, useCallback } from 'react';
import { Spinner, Tooltip } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { SpaceStorageInfo } from '../../services/api';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Visually distinct colors for up to ~16 spaces; wraps around for more
const SPACE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#84cc16', // lime
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#eab308', // yellow
];

const PERSONAL_AGGREGATE_COLOR = '#8b5cf6'; // violet for the aggregate row

/** A display row — either a regular space or the personal-spaces aggregate. */
interface DisplayRow {
  id: string;
  name: string;
  storage_used: number;
  storage_limit: number;
  file_count: number;
  color: string;
  isAggregate?: boolean;
  children?: DisplayRow[];
}

export function StorageManager() {
  const [spaces, setSpaces] = useState<SpaceStorageInfo[]>([]);
  const [totalUsed, setTotalUsed] = useState(0);
  const [maxStorageBytes, setMaxStorageBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [personalExpanded, setPersonalExpanded] = useState(false);
  const [personalTotalLimit, setPersonalTotalLimit] = useState(0);
  const [expandedSpaceId, setExpandedSpaceId] = useState<string | null>(null);
  const [spaceBreakdowns, setSpaceBreakdowns] = useState<
    Record<string, api.StorageBreakdownEntry[]>
  >({});

  const toggleSpaceExpand = useCallback(
    (spaceId: string) => {
      if (expandedSpaceId === spaceId) {
        setExpandedSpaceId(null);
        return;
      }
      setExpandedSpaceId(spaceId);
      if (!spaceBreakdowns[spaceId]) {
        api.getSpaceStorage(spaceId).then((data) => {
          setSpaceBreakdowns((prev) => ({
            ...prev,
            [spaceId]: data.breakdown.filter((e) => e.used > 0),
          }));
        });
      }
    },
    [expandedSpaceId, spaceBreakdowns],
  );

  useEffect(() => {
    Promise.all([api.getAdminStorage(), api.getAdminSettings()])
      .then(([storageData, settings]) => {
        setSpaces(storageData.spaces);
        setTotalUsed(storageData.total_used);
        setMaxStorageBytes(settings.max_storage_size);
        setPersonalTotalLimit(settings.personal_spaces_total_storage_limit);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  // Split into regular + personal, build display rows
  const { displayRows, barSegments } = useMemo(() => {
    const regular = spaces.filter((s) => !s.is_personal);
    const personal = spaces.filter((s) => s.is_personal);

    const rows: DisplayRow[] = [];
    let colorIdx = 0;

    // Regular spaces get individual colors
    for (const s of regular) {
      rows.push({
        id: s.space_id,
        name: s.space_name,
        storage_used: s.storage_used,
        storage_limit: s.storage_limit,
        file_count: s.file_count,
        color: SPACE_COLORS[colorIdx++ % SPACE_COLORS.length],
      });
    }

    // Personal spaces aggregate
    if (personal.length > 0) {
      const children: DisplayRow[] = personal
        .map((s, i) => ({
          id: s.space_id,
          name: s.personal_owner_name || s.space_name,
          storage_used: s.storage_used,
          storage_limit: s.storage_limit,
          file_count: s.file_count,
          color: SPACE_COLORS[(colorIdx + i) % SPACE_COLORS.length],
        }))
        .sort((a, b) => b.storage_used - a.storage_used);

      rows.push({
        id: '__personal_aggregate__',
        name: 'User personal spaces',
        storage_used: personal.reduce((sum, s) => sum + s.storage_used, 0),
        storage_limit: 0,
        file_count: personal.reduce((sum, s) => sum + s.file_count, 0),
        color: PERSONAL_AGGREGATE_COLOR,
        isAggregate: true,
        children,
      });
    }

    // Sort top-level rows by storage used (largest first)
    rows.sort((a, b) => b.storage_used - a.storage_used);

    // Top-level bar always shows aggregate (one segment per top-level row)
    const segments: {
      id: string;
      name: string;
      storage_used: number;
      color: string;
    }[] = [];
    for (const row of rows) {
      segments.push({
        id: row.id,
        name: row.name,
        storage_used: row.storage_used,
        color: row.color,
      });
    }

    return { displayRows: rows, barSegments: segments };
  }, [spaces]);

  if (loading) {
    return (
      <div className='flex justify-center py-12'>
        <Spinner size='lg' />
      </div>
    );
  }

  if (error) {
    return <div className='text-danger text-sm py-4'>{error}</div>;
  }

  const barTotal = maxStorageBytes > 0 ? maxStorageBytes : totalUsed;
  const overallPercent =
    maxStorageBytes > 0
      ? Math.min((totalUsed / maxStorageBytes) * 100, 100)
      : 0;

  const spaceStorageSum = spaces.reduce((sum, s) => sum + s.storage_used, 0);
  const otherStorage = Math.max(totalUsed - spaceStorageSum, 0);

  const renderSpaceRow = (row: DisplayRow, indent = false) => {
    const hasLimit = row.storage_limit > 0;
    const barPct = hasLimit
      ? Math.min((row.storage_used / row.storage_limit) * 100, 100)
      : row.storage_used > 0
        ? 100
        : 0;
    const nearLimit = hasLimit && barPct >= 80;
    const isExpanded = expandedSpaceId === row.id;
    const breakdown = spaceBreakdowns[row.id];

    return (
      <div key={row.id} className={indent ? 'ml-6' : ''}>
        <button
          type='button'
          onClick={() => toggleSpaceExpand(row.id)}
          className='w-full cursor-pointer'
        >
          <div className='bg-content2/30 rounded-lg p-3'>
            <div className='flex items-center justify-between mb-2'>
              <div className='flex items-center gap-2 min-w-0'>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`text-[10px] text-default-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
                <span
                  className='inline-block w-3 h-3 rounded-sm shrink-0'
                  style={{ backgroundColor: row.color }}
                />
                <span className='text-sm font-medium truncate'>{row.name}</span>
                <span className='text-xs text-default-400'>
                  {row.file_count} file{row.file_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className='text-right shrink-0'>
                <span className='text-sm font-medium'>
                  {formatSize(row.storage_used)}
                </span>
                {hasLimit && (
                  <span className='text-xs text-default-400 ml-1'>
                    / {formatSize(row.storage_limit)}
                  </span>
                )}
              </div>
            </div>
            {isExpanded && breakdown ? (
              <div className='h-2 bg-default-200 rounded-full overflow-hidden flex'>
                {breakdown.map((entry, i) => {
                  const denominator = hasLimit
                    ? row.storage_limit
                    : row.storage_used;
                  const entryPct =
                    denominator > 0 ? (entry.used / denominator) * 100 : 0;
                  if (entryPct < 0.3) return null;
                  return (
                    <Tooltip
                      key={entry.name + entry.type}
                      content={`${entry.name}: ${formatSize(entry.used)}`}
                    >
                      <div
                        className='h-full transition-all cursor-default first:rounded-l-full'
                        style={{
                          width: `${entryPct}%`,
                          backgroundColor:
                            SPACE_COLORS[i % SPACE_COLORS.length],
                          minWidth: 3,
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            ) : (
              <div className='h-2 bg-default-200 rounded-full overflow-hidden'>
                <div
                  className={`h-full rounded-full transition-all ${nearLimit ? 'bg-warning' : ''}`}
                  style={{
                    width: `${Math.max(barPct, 1)}%`,
                    ...(nearLimit ? {} : { backgroundColor: row.color }),
                  }}
                />
              </div>
            )}
            {hasLimit && (
              <p
                className={`text-[10px] mt-1 ${nearLimit ? 'text-warning' : 'text-default-400'}`}
              >
                {barPct.toFixed(0)}% of limit used
                {nearLimit && ' — approaching limit'}
              </p>
            )}
          </div>
        </button>
        {isExpanded && breakdown && (
          <div className='space-y-1 mt-2 ml-6'>
            {breakdown.map((entry, i) => {
              const pct =
                row.storage_used > 0
                  ? (entry.used / row.storage_used) * 100
                  : 0;
              const color = SPACE_COLORS[i % SPACE_COLORS.length];
              return (
                <div
                  key={entry.name + entry.type}
                  className='flex items-center gap-2 px-3 py-1.5'
                >
                  <span
                    className='inline-block w-2.5 h-2.5 rounded-sm shrink-0'
                    style={{ backgroundColor: color }}
                  />
                  <span className='text-sm text-foreground flex-1 truncate'>
                    {entry.name}
                  </span>
                  <span className='text-xs text-default-400 shrink-0'>
                    {formatSize(entry.used)}
                  </span>
                  <span className='text-xs text-default-400 shrink-0 w-12 text-right'>
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {isExpanded && !breakdown && (
          <div className='flex justify-center py-3 ml-6'>
            <Spinner size='sm' />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className='space-y-6'>
      {/* Total overview */}
      <div className='bg-content2/50 rounded-lg p-4'>
        <p className='text-xs text-default-400 uppercase tracking-wider mb-1'>
          Total Storage Used
        </p>
        <p className='text-2xl font-semibold text-foreground'>
          {formatSize(totalUsed)}
          {maxStorageBytes > 0 && (
            <span className='text-base font-normal text-default-400 ml-2'>
              / {formatSize(maxStorageBytes)}
            </span>
          )}
        </p>
        {maxStorageBytes > 0 && (
          <p className='text-xs text-default-400 mt-0.5'>
            {overallPercent.toFixed(1)}% of server limit used
          </p>
        )}
        <p className='text-xs text-default-400 mt-1'>
          Across {spaces.length} space{spaces.length !== 1 ? 's' : ''} with
          files
        </p>

        {/* Stacked bar chart */}
        {barTotal > 0 && barSegments.length > 0 && (
          <div className='mt-3'>
            <div className='h-5 bg-default-200 rounded-full overflow-hidden flex'>
              {barSegments
                .filter((s) => s.storage_used > 0)
                .map((s) => {
                  const widthPct = (s.storage_used / barTotal) * 100;
                  if (widthPct < 0.3) return null;
                  return (
                    <Tooltip
                      key={s.id}
                      content={`${s.name}: ${formatSize(s.storage_used)}`}
                    >
                      <div
                        className='h-full transition-all cursor-default first:rounded-l-full'
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: s.color,
                          minWidth: widthPct > 0 ? 3 : 0,
                        }}
                      />
                    </Tooltip>
                  );
                })}
              {otherStorage > 0 && (otherStorage / barTotal) * 100 >= 0.3 && (
                <Tooltip
                  content={`Other (messages): ${formatSize(otherStorage)}`}
                >
                  <div
                    className='h-full transition-all cursor-default'
                    style={{
                      width: `${(otherStorage / barTotal) * 100}%`,
                      backgroundColor: '#71717a',
                      minWidth: 3,
                    }}
                  />
                </Tooltip>
              )}
            </div>

            {/* Legend */}
            <div className='flex flex-wrap gap-x-3 gap-y-1 mt-2'>
              {barSegments
                .filter((s) => s.storage_used > 0)
                .map((s) => (
                  <div
                    key={s.id}
                    className='flex items-center gap-1.5 text-xs text-default-500'
                  >
                    <span
                      className='inline-block w-2.5 h-2.5 rounded-sm shrink-0'
                      style={{ backgroundColor: s.color }}
                    />
                    <span className='truncate max-w-[120px]'>{s.name}</span>
                  </div>
                ))}
              {otherStorage > 0 && (
                <div className='flex items-center gap-1.5 text-xs text-default-500'>
                  <span
                    className='inline-block w-2.5 h-2.5 rounded-sm shrink-0'
                    style={{ backgroundColor: '#71717a' }}
                  />
                  <span>Other</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Per-space breakdown */}
      {displayRows.length > 0 ? (
        <div className='space-y-3'>
          <h3 className='text-sm font-semibold text-foreground'>
            Per-Space Breakdown
          </h3>
          {displayRows.map((row) => {
            if (row.isAggregate) {
              return (
                <div key={row.id}>
                  {/* Aggregate clickable header */}
                  <button
                    type='button'
                    onClick={() => setPersonalExpanded((v) => !v)}
                    className='w-full cursor-pointer'
                  >
                    <div className='bg-content2/30 rounded-lg p-3'>
                      <div className='flex items-center justify-between mb-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <FontAwesomeIcon
                            icon={faChevronRight}
                            className={`text-[10px] text-default-400 transition-transform ${personalExpanded ? 'rotate-90' : ''}`}
                          />
                          <span
                            className='inline-block w-3 h-3 rounded-sm shrink-0'
                            style={{
                              backgroundColor: personalExpanded
                                ? 'transparent'
                                : PERSONAL_AGGREGATE_COLOR,
                              border: personalExpanded
                                ? `2px solid ${PERSONAL_AGGREGATE_COLOR}`
                                : 'none',
                            }}
                          />
                          <span className='text-sm font-medium truncate'>
                            {row.name}
                          </span>
                          <span className='text-xs text-default-400'>
                            {row.children?.length ?? 0} user
                            {(row.children?.length ?? 0) !== 1
                              ? 's'
                              : ''} · {row.file_count} file
                            {row.file_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className='text-right shrink-0'>
                          <span className='text-sm font-medium'>
                            {formatSize(row.storage_used)}
                          </span>
                          {personalTotalLimit > 0 && (
                            <span className='text-xs text-default-400 ml-1'>
                              / {formatSize(personalTotalLimit)}
                            </span>
                          )}
                        </div>
                      </div>
                      {(() => {
                        const hasAggLimit = personalTotalLimit > 0;
                        const aggPct = hasAggLimit
                          ? Math.min(
                              (row.storage_used / personalTotalLimit) * 100,
                              100,
                            )
                          : row.storage_used > 0
                            ? 100
                            : 0;
                        const nearAggLimit = hasAggLimit && aggPct >= 80;

                        if (personalExpanded && row.children) {
                          return (
                            <>
                              <div className='h-2 bg-default-200 rounded-full overflow-hidden flex'>
                                {row.children
                                  .filter((c) => c.storage_used > 0)
                                  .map((child) => {
                                    const denominator = hasAggLimit
                                      ? personalTotalLimit
                                      : row.storage_used;
                                    const childPct =
                                      denominator > 0
                                        ? (child.storage_used / denominator) *
                                          100
                                        : 0;
                                    if (childPct < 0.3) return null;
                                    return (
                                      <Tooltip
                                        key={child.id}
                                        content={`${child.name}: ${formatSize(child.storage_used)}`}
                                      >
                                        <div
                                          className='h-full transition-all cursor-default first:rounded-l-full'
                                          style={{
                                            width: `${childPct}%`,
                                            backgroundColor: child.color,
                                            minWidth: 3,
                                          }}
                                        />
                                      </Tooltip>
                                    );
                                  })}
                              </div>
                              {hasAggLimit && (
                                <p
                                  className={`text-[10px] mt-1 ${nearAggLimit ? 'text-warning' : 'text-default-400'}`}
                                >
                                  {aggPct.toFixed(0)}% of total limit used
                                  {nearAggLimit && ' — approaching limit'}
                                </p>
                              )}
                            </>
                          );
                        }

                        return (
                          <>
                            <div className='h-2 bg-default-200 rounded-full overflow-hidden'>
                              <div
                                className={`h-full rounded-full transition-all ${nearAggLimit ? 'bg-warning' : ''}`}
                                style={{
                                  width: `${Math.max(aggPct, 1)}%`,
                                  ...(nearAggLimit
                                    ? {}
                                    : {
                                        backgroundColor:
                                          PERSONAL_AGGREGATE_COLOR,
                                      }),
                                }}
                              />
                            </div>
                            {hasAggLimit && (
                              <p
                                className={`text-[10px] mt-1 ${nearAggLimit ? 'text-warning' : 'text-default-400'}`}
                              >
                                {aggPct.toFixed(0)}% of total limit used
                                {nearAggLimit && ' — approaching limit'}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </button>
                  {/* Expanded children */}
                  {personalExpanded && row.children && (
                    <div className='space-y-2 mt-2'>
                      {row.children.map((child) => renderSpaceRow(child, true))}
                    </div>
                  )}
                </div>
              );
            }
            return renderSpaceRow(row);
          })}
        </div>
      ) : (
        <p className='text-sm text-default-400 text-center py-8'>
          No spaces are using file storage yet.
        </p>
      )}
    </div>
  );
}
