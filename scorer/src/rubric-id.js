// Targets and challenge ids share one charset: both become Redis key/field
// segments (`ctf:solves:<target>`, `<author>:<challengeId>`). Lives in its own
// module because both rubric.js and catalogue.js need it and rubric.js imports
// catalogue.js.
export const RUBRIC_ID = /^[a-z0-9][a-z0-9-]*$/;
