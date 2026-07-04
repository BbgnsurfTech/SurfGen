'use client';

import { EmptyState } from '../../../components/ui/states';
import { useGatewaySettings } from '../../../lib/api/hooks';
import { GatewayCard } from './gateway-card';
import { PlanEditor } from './plan-editor';

export default function PaymentsPage() {
  const settings = useGatewaySettings();
  const isForbidden = settings.isError && /forbidden|super-admin/i.test(settings.error.message);

  return (
    <div className="sg-fade px-8 pt-6 pb-12">
      <div className="mb-[18px]">
        <div className="font-display text-[15px] font-bold">Payments</div>
        <div className="mt-0.5 text-[12.5px] text-taupe">
          Paystack gateway configuration and subscription plans — deployment-wide, super-admin only
        </div>
      </div>

      {isForbidden ? (
        <EmptyState
          title="Super-admin access required"
          hint="Payment gateway settings are deployment-wide. Ask an administrator for access."
        />
      ) : (
        <div className="grid grid-cols-[minmax(320px,420px)_1fr] gap-4 max-lg:grid-cols-1">
          <GatewayCard />
          <PlanEditor />
        </div>
      )}
    </div>
  );
}
