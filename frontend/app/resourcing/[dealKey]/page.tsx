"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectWizard } from "@/components/wizard/ProjectWizard";
import { EmployeeProfileModal, type ProfileTab, type SkillMatchContext } from "@/components/shared/EmployeeProfileModal";

// An isolated route per deal (instead of local component state on the
// Resourcing picker page) so opening a deal's wizard survives a refresh --
// the wizard's own step, and which deal it's for, comes straight from the
// URL instead of requiring a trip back through the deal list to re-select it.
export default function ResourcingWizardPage({ params }: { params: { dealKey: string } }) {
  const router = useRouter();
  const [openProfile, setOpenProfile] = useState<{ employeeId: string; tab: ProfileTab; skillMatchContext?: SkillMatchContext } | null>(null);

  return (
    <div className="p-4 sm:p-6">
      <ProjectWizard
        initialDealKey={params.dealKey}
        onExit={() => router.push("/resourcing/deals")}
        onOpenProfile={(employeeId, tab, skillMatchContext) => setOpenProfile({ employeeId, tab, skillMatchContext })}
      />
      {openProfile && (
        <EmployeeProfileModal
          employeeId={openProfile.employeeId}
          initialTab={openProfile.tab}
          skillMatchContext={openProfile.skillMatchContext}
          onClose={() => setOpenProfile(null)}
        />
      )}
    </div>
  );
}
