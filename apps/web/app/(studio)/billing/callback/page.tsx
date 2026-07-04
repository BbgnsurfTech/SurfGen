'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoadingState } from '../../../../components/ui/states';
import { useVerifyCheckout } from '../../../../lib/api/hooks';

function StatusCard({ tone, title }: { tone: 'paid' | 'pending' | 'failed'; title: string }) {
  const dot = tone === 'paid' ? 'bg-success' : tone === 'pending' ? 'bg-camel' : 'bg-danger';
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-card p-6 text-center shadow-[0_1px_2px_rgba(26,26,26,.04)]">
      <span className={`mx-auto mb-3 block size-2.5 rounded-full ${dot}`} />
      <div className="font-display text-[15px] font-bold">{title}</div>
      <Link
        href="/billing"
        className="mt-4 inline-block rounded-full border border-line px-[18px] py-2 text-[12.5px] font-bold text-primary"
      >
        Back to billing
      </Link>
    </div>
  );
}

/** Paystack redirects here with ?reference= — confirm server-side, never trust the URL. */
function CallbackInner() {
  const params = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref');
  const verify = useVerifyCheckout(reference);

  if (!reference) return <StatusCard tone="failed" title="Missing payment reference" />;
  if (verify.isPending) return <LoadingState label="Confirming your payment with Paystack…" />;
  if (verify.isError) return <StatusCard tone="failed" title="We could not confirm this payment" />;

  const status = verify.data.status;
  if (status === 'paid') return <StatusCard tone="paid" title="Payment confirmed — your plan is active" />;
  if (status === 'pending') return <StatusCard tone="pending" title="Payment is still processing" />;
  return <StatusCard tone="failed" title="Payment failed — you have not been charged" />;
}

export default function BillingCallbackPage() {
  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <Suspense fallback={<LoadingState label="Confirming your payment…" />}>
        <CallbackInner />
      </Suspense>
    </div>
  );
}
