import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { admin, library } from '../lib/api';

export default function Admin() {
  const [scanLoading, setScanLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
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

  const scanMutation = useMutation({
    mutationFn: () => admin.scan(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] });
      queryClient.invalidateQueries({ queryKey: ['library-stats'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      setScanMessage('Scan started successfully!');
      setTimeout(() => setScanMessage(''), 5000);
    },
    onError: (error: any) => {
      setScanMessage(error.response?.data?.error || 'Scan failed');
      setTimeout(() => setScanMessage(''), 5000);
    },
  });

  const handleScan = async () => {
    setScanLoading(true);
    try {
      await scanMutation.mutateAsync();
    } finally {
      setScanLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
          <p className="text-zinc-400 mt-1">Manage your North Star server</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Books"
            value={stats?.data?.books || 0}
            icon="📚"
            color="blue"
          />
          <StatCard
            title="Authors"
            value={stats?.data?.authors || 0}
            icon="✍️"
            color="purple"
          />
          <StatCard
            title="EPUB Files"
            value={stats?.data?.formatCounts?.find((f: any) => f.format === 'EPUB')?.count || 0}
            icon="📖"
            color="green"
          />
          <StatCard
            title="PDF Files"
            value={stats?.data?.formatCounts?.find((f: any) => f.format === 'PDF')?.count || 0}
            icon="📄"
            color="orange"
          />
        </div>

        {/* Library Scan Section */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Library Scan</h2>
              <p className="text-zinc-400">
                Scan your books folder to import new books and update existing ones
              </p>
            </div>
            <button
              onClick={handleScan}
              disabled={scanLoading}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
            >
              {scanLoading ? (
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

          {scanMessage && (
            <div className={`p-4 rounded-lg ${
              scanMessage.includes('success')
                ? 'bg-green-500/10 border border-green-500/50 text-green-400'
                : 'bg-red-500/10 border border-red-500/50 text-red-400'
            }`}>
              {scanMessage}
            </div>
          )}
        </div>

        {/* Scan History */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Recent Scans</h2>

          {scans && scans.length > 0 ? (
            <div className="space-y-3">
              {scans.map((scan: any) => (
                <div
                  key={scan.id}
                  className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <StatusBadge status={scan.status} />
                      <span className="text-sm text-zinc-400">
                        {new Date(scan.started_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center space-x-6 text-sm">
                      <Stat label="Scanned" value={scan.files_scanned} color="text-zinc-300" />
                      <Stat label="Added" value={scan.files_added} color="text-green-400" />
                      <Stat label="Updated" value={scan.files_updated} color="text-blue-400" />
                      <Stat label="Removed" value={scan.files_removed} color="text-red-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-center py-8">No scans yet</p>
          )}
        </div>

        {/* System Info */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">System Information</h2>
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

const colorClasses = {
  blue: 'from-blue-600 to-blue-700',
  purple: 'from-purple-600 to-purple-700',
  green: 'from-green-600 to-green-700',
  orange: 'from-orange-600 to-orange-700',
  slate: 'from-slate-600 to-slate-700',
};

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  color: keyof typeof colorClasses;
}) {
  const gradient = colorClasses[color] ?? colorClasses.slate;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-2xl`}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold text-white mb-1">{value.toLocaleString()}</div>
      <div className="text-sm text-zinc-400">{title}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    COMPLETED: 'bg-green-500/20 text-green-400 border-green-500/30',
    RUNNING: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    FAILED: 'bg-red-500/20 text-red-400 border-red-500/30',
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
      <span className="text-zinc-500">{label}:</span>
      <span className={`ml-1 font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
      <span className="text-zinc-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
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
