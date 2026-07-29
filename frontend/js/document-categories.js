/* ===================================================
   Shared by documents/script.js and document-library/script.js - the
   authenticated Documents page and the public (no-login) Document
   Library both need to turn a documents.category enum value into its
   display label, and previously kept two separate identical copies of
   this map. This is a standalone, zero-dependency data file (no
   DOMContentLoaded handlers, no auth checks) specifically so the public
   Document Library can load it without pulling in js/common.js, whose
   own DOMContentLoaded handler redirects any session-less visitor
   straight to Login - exactly the gate that page must never have.
   =================================================== */

const LINGKOD_DOCUMENT_CATEGORY_LABELS = {
    memorandum: "Memorandum",
    resolution: "Resolution",
    financial_report: "Financial Report",
    policy: "Policy",
    form: "Forms",
    organization_records: "Organization Records",
    accreditation: "Accreditation",
    constitution_bylaws: "Constitution and By-Laws",
    activity_documents: "Activity Documents",
    other: "Others"
};
