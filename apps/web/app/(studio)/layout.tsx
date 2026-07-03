import { AuthGate } from '../../components/shell/auth-gate';
import { LiveToasts } from '../../components/shell/live-toasts';
import { QueryProvider } from '../../components/shell/query-provider';
import { Sidebar } from '../../components/shell/sidebar';
import { Topbar } from '../../components/shell/topbar';
import { ToastProvider } from '../../components/ui/toast';
import { LiveEventsProvider } from '../../lib/api/live';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ToastProvider>
      <AuthGate>
      <LiveEventsProvider>
      <LiveToasts />
      <div className="flex h-dvh w-full overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-paper">
          <Topbar />
          <section className="relative flex-1 overflow-y-auto">{children}</section>
        </main>
      </div>
      </LiveEventsProvider>
      </AuthGate>
      </ToastProvider>
    </QueryProvider>
  );
}
