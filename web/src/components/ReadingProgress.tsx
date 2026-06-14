interface ReadingProgressProps {
  progress: number; // 0-100
  lastRead?: Date | string;
  showPercentage?: boolean;
  showLastRead?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function ReadingProgress({
  progress,
  lastRead,
  showPercentage = true,
  showLastRead = false,
  size = 'md',
}: ReadingProgressProps) {
  const height = size === 'sm' ? 'h-1' : size === 'md' ? 'h-1.5' : 'h-2';
  const textSize = size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-xs' : 'text-sm';

  const getDaysAgo = (date: Date | string) => {
    const lastReadDate = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - lastReadDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  return (
    <div className="space-y-1.5">
      {/* Progress Bar */}
      <div className={`w-full bg-parchment-300/70 rounded-full overflow-visible ${height} relative`}>
        <div
          className={`h-full bg-gradient-to-r from-ember-500 to-ember-400 transition-all duration-250 ease-soft rounded-full`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {/* Progress Info */}
      {(showPercentage || showLastRead) && (
        <div className="flex items-center justify-between">
          {showPercentage && (
            <span className={`${textSize} font-medium text-ember-700`}>
              {Math.round(progress)}% complete
            </span>
          )}
          {showLastRead && lastRead && (
            <span className={`${textSize} text-ink-400`}>
              {getDaysAgo(lastRead)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
