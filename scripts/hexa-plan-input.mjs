export function parsePlanJson(raw) {
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Plan JSON is invalid: ${error.message}`);
  }

  const items = Array.isArray(plan) ? plan : plan?.items;
  if (!Array.isArray(items)) {
    throw new Error("Plan JSON must be an array or contain an items array");
  }
  return items;
}
