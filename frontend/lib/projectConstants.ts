// Real distinct values observed in backend/data/Transformed/02_Project_Details_clean.csv --
// not fabricated. Shared by the recommendations picker (CreateProjectSection) and the
// Project Wizard's Step 1 (Project Information) / Step 3 (Budget Creation).
export const PROJECT_TYPE_OPTIONS = ["Client Project", "Internal Project", "Managed Services", "BAU Activity", "Sales Activity"];

export const PROJECT_STATUS_OPTIONS = [
  "ACTIVE", "PROPOSE", "DEAL WON", "DEAL LOST", "COMPLETE", "CLOSED",
  "SOW PENDING SIGNATURE", "SCOPING APPROVAL",
];

// The 6 real, canonical proposition CoEs (RM-confirmed) -- historical project records carry
// extra messy variants/typos ("Managed Service", "Data and Reporting", "PE Services", etc.)
// which stay as-is on existing rows, but only these 6 are offered when setting the field
// going forward.
export const PROPOSITION_COE_OPTIONS = [
  "Managed Services", "Exit Support", "Due Diligence", "Data Advisory", "Core Reporting", "Value Creation",
];

// This app has no data at all for these 3 JIN fields -- omitted from Step 1
// rather than fabricated (Cluster here is a JIN org concept, distinct from
// the numeric pipeline "cluster" field used elsewhere for demand rows).
export const UNTRACKED_PROJECT_INFO_FIELDS = ["Cluster", "Coverage Location", "DevOps Board"];

// Real locations this app tracks employees/hires against (headcount prediction,
// role-mix engines) -- used for the Step 3 budget table's Role (designation +
// location) picker.
export const JMAN_LOCATIONS = ["Chennai", "UK", "USA"];

// Step 2 (Project GDPR) -- dropdown value lists were collapsed in JIN's own
// screenshot (all showing "-- Select --"), so these are reasonable standard
// GDPR-compliance categories as an editable starting point, not reverse-
// engineered from JIN. Field labels/order match the screenshot exactly.
export const GDPR_YES_NO = ["Yes", "No"];
export const GDPR_FIELD_DEFS: { key: string; label: string; type: "select" | "text"; options?: string[]; fullWidth?: boolean }[] = [
  { key: "personal_data_collected", label: "Has personal data been collected?", type: "select", options: GDPR_YES_NO, fullWidth: true },
  { key: "purpose", label: "What is the purpose?", type: "select", options: ["Client delivery", "Internal analytics", "Reporting", "Support & maintenance", "Other"] },
  { key: "retention_period", label: "What is the retention period?", type: "select", options: ["Duration of engagement", "1 year post-engagement", "3 years", "6 years", "7 years", "Indefinite"] },
  { key: "special_category_data", label: "Is there special category data?", type: "select", options: GDPR_YES_NO },
  { key: "special_category_conditions", label: "Conditions for special category data?", type: "select", options: ["Not applicable", "Explicit consent", "Employment/social security law", "Vital interests", "Legitimate activities of a foundation/association"] },
  { key: "legal_basis", label: "What is the legal basis to process data?", type: "select", options: ["Consent", "Contract", "Legal obligation", "Vital interests", "Public task", "Legitimate interests"] },
  { key: "under_13_data", label: "Is there personal data of under 13 year olds?", type: "select", options: GDPR_YES_NO },
  { key: "data_processed", label: "What data is being processed?", type: "select", options: ["Contact details", "Employment data", "Financial data", "Health data", "Usage/behavioural data", "None"] },
  { key: "data_storage_location", label: "Where is data stored?", type: "select", options: ["Client environment", "JMAN internal systems", "Cloud (client-approved)", "Cloud (JMAN-approved)"] },
  { key: "dpa_signed", label: "Has the appropriate DPA been signed?", type: "select", options: ["Yes", "No", "Pending"] },
  { key: "transfer_to_jman_digital", label: "Is there transfer to JMAN Digital?", type: "select", options: GDPR_YES_NO },
  { key: "transfer_to_third_parties", label: "Is there transfer to other third parties?", type: "select", options: GDPR_YES_NO },
  { key: "third_parties", label: "Which third parties?", type: "text" },
];

// Step 3 (Budget Creation) header dropdowns -- same "collapsed in the
// screenshot" caveat as GDPR.
export const BILLING_CURRENCY_OPTIONS = ["GBP", "USD", "EUR", "INR"];
export const ENGAGEMENT_STYLE_OPTIONS = ["Time & Materials", "Fixed Price", "Retainer", "Managed Service"];
export const PAYMENT_TERM_OPTIONS = ["Net 15", "Net 30", "Net 45", "Net 60", "Net 90"];

// Step 6 (Project Kickoff) -- same pattern.
export const KICKOFF_TOPIC_FIELDS: { key: string; label: string }[] = [
  { key: "covered_client_background", label: "Client background" },
  { key: "covered_proposal_review", label: "Proposal review" },
  { key: "covered_problem_statement", label: "Problem statement" },
  { key: "covered_stakeholders_plan", label: "Client stakeholders and management plan" },
  { key: "covered_client_kickoff_prep", label: "Preparation for client kick-off" },
  { key: "covered_team_roles", label: "Team member roles and responsibilities" },
  { key: "covered_development_goals", label: "Development goals" },
  { key: "covered_ways_of_working", label: "Ways of working" },
];
