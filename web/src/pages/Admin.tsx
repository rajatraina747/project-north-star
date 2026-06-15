import { useState, useRef } from 'react';
import type { ReactNode, ChangeEvent } from 'react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { admin, library } from '../lib/api';
import ScanProgress from '../components/ScanProgress';

export default function Admin() {
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['library-stats'],
    queryFn: () => library.stats(),
  });

  const { data: scans } = useQuery({
    queryKey: ['scans'],
    queryFn: async () => {
      const response = await admin.getScans(10);
      return response.data;
    },
  });

  // Adopt an already-running scan (e.g. started elsewhere or page reloaded) so
  // its live progress shows without needing to re-trigger.
  useEffect(() => {
    if (activeScanId || !scans) return;
    const running = scans.find((s) => s.status === 'RUNNING');
    if (running) setActiveScanId(running.id);
  }, [scans, activeScanId]);

  const scanMutation = useMutation({
    mutationFn: () => admin.scan(false),
    onSuccess: (res: any) => {
      setActiveScanId(res.data?.scan_id ?? null);
      queryClient.invalidateQueries({ queryKey: ['scans'] });
      setScanMessage('Scan started successfully!');
      setTimeout(() => setScanMessage(''), 5000);
    },
    onError: (error: any) => {
      setScanMessage(error.response?.data?.error || 'Scan failed');
      setTimeout(() => setScanMessage(''), 5000);
    },
  });

  const handleScanComplete = () => {
    setActiveScanId(null);
    queryClient.invalidateQueries({ queryKey: ['scans'] });
    queryClient.invalidateQueries({ queryKey: ['library-stats'] });
    queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const handleScan = async () => {
    setScanLoading(true);
    try {
      await scanMutation.mutateAsync();
    } finally {
      setScanLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-parchment-100/70 border-b border-parchment-300">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <h1 className="text-3xl font-serif font-bold text-ink-900">Admin Panel</h1>
          <p className="text-ink-500 mt-1">Manage your North Star server</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Books"
            value={stats?.data?.books || 0}
            icon={<BooksIcon />}
          />
          <StatCard
            title="Authors"
            value={stats?.data?.authors || 0}
            icon={<AuthorIcon />}
          />
          <StatCard
            title="EPUB Files"
            value={stats?.data?.formatCounts?.find((f: any) => f.format === 'EPUB')?.count || 0}
            icon={<BookOpenIcon />}
          />
          <StatCard
            title="PDF Files"
            value={stats?.data?.formatCounts?.find((f: any) => f.format === 'PDF')?.count || 0}
            icon={<DocumentIcon />}
          />
        </div>

        {/* Management shortcuts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            to="/admin/users"
            className="flex items-center justify-between bg-parchment-100/70 rounded-xl border border-parchment-300 p-6 hover:bg-parchment-200/70 transition-colors group"
          >
            <div>
              <h2 className="text-xl font-serif font-semibold text-ink-900 mb-1">User Management</h2>
              <p className="text-ink-500 text-sm">Create accounts, set roles, disable or remove users</p>
            </div>
            <svg className="w-6 h-6 text-ink-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            to="/admin/duplicates"
            className="flex items-center justify-between bg-parchment-100/70 rounded-xl border border-parchment-300 p-6 hover:bg-parchment-200/70 transition-colors group"
          >
            <div>
              <h2 className="text-xl font-serif font-semibold text-ink-900 mb-1">Duplicate Report</h2>
              <p className="text-ink-500 text-sm">Find exact and near-duplicate books and files</p>
            </div>
            <svg className="w-6 h-6 text-ink-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* Upload Section */}
        <UploadSection
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: ['scans'] });
            queryClient.invalidateQueries({ queryKey: ['library-stats'] });
            queryClient.invalidateQueries({ queryKey: ['books'] });
          }}
        />

        {/* Library Scan Section */}
        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-serif font-semibold text-ink-900 mb-2">Library Scan</h2>
              <p className="text-ink-500">
                Scan your books folder to import new books and update existing ones
              </p>
            </div>
            <button
              onClick={handleScan}
              disabled={scanLoading || !!activeScanId}
              className="flex items-center space-x-2 px-6 py-3 bg-ember-500 hover:bg-ember-600 disabled:bg-ember-300 disabled:cursor-not-allowed text-cream font-semibold rounded-lg transition shadow-warm"
            >
              {scanLoading || activeScanId ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Start Scan</span>
                </>
              )}
            </button>
          </div>

          {activeScanId && (
            <div className="mb-4 p-4 rounded-lg bg-parchment-50 border border-parchment-300">
              <ScanProgress scanId={activeScanId} onComplete={handleScanComplete} />
            </div>
          )}

          {scanMessage && !activeScanId && (
            <div className={`p-4 rounded-lg ${
              scanMessage.includes('success')
                ? 'bg-green-600/10 border border-green-600/30 text-green-800'
                : 'bg-red-600/10 border border-red-600/30 text-red-800'
            }`}>
              {scanMessage}
            </div>
          )}
        </div>

        {/* Scan History */}
        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">Recent Scans</h2>

          {scans && scans.length > 0 ? (
            <div className="space-y-3">
              {scans.map((scan: any) => (
                <div
                  key={scan.id}
                  className="flex items-center justify-between p-4 bg-parchment-50 rounded-lg border border-parchment-300"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <StatusBadge status={scan.status} />
                      <span className="text-sm text-ink-400">
                        {new Date(scan.started_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center space-x-6 text-sm">
                      <Stat label="Scanned" value={scan.files_scanned} color="text-ink-700" />
                      <Stat label="Added" value={scan.files_added} color="text-green-700" />
                      <Stat label="Updated" value={scan.files_updated} color="text-ember-700" />
                      <Stat label="Removed" value={scan.files_removed} color="text-red-700" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ink-400 text-center py-8">No scans yet</p>
          )}
        </div>

        {/* System Info */}
        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">System Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoRow label="API Version" value="1.0.0" />
            <InfoRow label="Database" value="PostgreSQL" />
            <InfoRow
              label="Total Library Size"
              value={formatBytes(stats?.data?.totalSize || 0)}
            />
            <InfoRow label="Server Status" value="Online" />
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!['.epub', '.pdf', '.cbz', '.mobi', '.azw3'].includes(ext)) {
      setError('Supported formats: EPUB, PDF, CBZ, MOBI, AZW3');
      return;
    }
    setError(null);
    setMessage(null);
    setUploading(true);
    setPercent(0);
    try {
      const res = await admin.uploadBook(file, setPercent);
      setMessage(res.data.message || 'Upload successful');
      onUploaded();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-2">Upload a Book</h2>
          <p className="text-ink-500">
            Add an EPUB, PDF, CBZ, MOBI, or AZW3 to your library. Metadata and the cover are extracted automatically.
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".epub,.pdf,.cbz,.mobi,.azw3" className="hidden" onChange={handleChange} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center space-x-2 px-6 py-3 bg-ember-500 hover:bg-ember-600 disabled:bg-ember-300 disabled:cursor-not-allowed text-cream font-semibold rounded-lg transition shadow-warm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span>{uploading ? `Uploading… ${percent}%` : 'Choose File'}</span>
        </button>
      </div>

      {uploading && (
        <div className="h-2 w-full bg-parchment-300 rounded-full overflow-hidden mb-3">
          <div className="h-full bg-ember-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {message && (
        <div className="p-4 rounded-lg bg-green-600/10 border border-green-600/30 text-green-800">{message}</div>
      )}
      {error && (
        <div className="p-4 rounded-lg bg-red-600/10 border border-red-600/30 text-red-800">{error}</div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6 shadow-warm">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-ember-500/12 text-ember-600 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="text-3xl font-serif font-bold text-ink-900 mb-1">{value.toLocaleString()}</div>
      <div className="text-sm text-ink-500">{title}</div>
    </div>
  );
}

const statIconClass = 'w-6 h-6';
function BooksIcon() {
  return (
    <svg className={statIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}
function AuthorIcon() {
  return (
    <svg className={statIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}
function BookOpenIcon() {
  return (
    <svg className={statIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}
function DocumentIcon() {
  return (
    <svg className={statIconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    COMPLETED: 'bg-green-600/12 text-green-800 border-green-600/25',
    RUNNING: 'bg-ember-500/15 text-ember-700 border-ember-500/30',
    FAILED: 'bg-red-600/12 text-red-800 border-red-600/25',
  };

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${colors[status as keyof typeof colors] || colors.COMPLETED}`}>
      {status}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <span className="text-ink-400">{label}:</span>
      <span className={`ml-1 font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-parchment-50 rounded-lg border border-parchment-300">
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-900 font-medium">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
