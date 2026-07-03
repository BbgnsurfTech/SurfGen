import { Sidebar } from '../../components/shell/sidebar';
import { Topbar } from '../../components/shell/topbar';
import { ToastProvider } from '../../components/ui/toast';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-paper">
          <Topbar />
          <section className="relative flex-1 overflow-y-auto">{children}</section>
        </main>
      </div>
    </ToastProvider>
  );
}
