import CatalogueAdmin from '@/app/_gear/CatalogueAdmin';
import { requirePlatformAdmin } from '@/lib/access';
import { listCapabilityDefs, listModels } from '@/lib/gear';

// The model catalogue, for the platform administrator (REQUIREMENTS G-3,
// G-6): suggestions to approve or reject, and each model's facts and
// capabilities, which every unit of it shares.

export const metadata = { title: 'Catalogue · Bottega' };

export default async function CataloguePage() {
  const admin = await requirePlatformAdmin();
  const [models, defs] = await Promise.all([listModels(admin.db), listCapabilityDefs(admin.db)]);
  return (
    <div className="py-4">
      <h1 className="mb-6 text-2xl">Catalogue</h1>
      <CatalogueAdmin initialModels={models} defs={defs} />
    </div>
  );
}
