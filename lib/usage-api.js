'use strict';

// The usage endpoint returns one flat limits[] array rather than the status
// line's keyed object. Reshaping it into the same form lets a fetched reading
// go through exactly the same merge as a status line one.
function payloadFromUsageApi(body) {
  if (!body || !Array.isArray(body.limits)) {
    return null;
  }

  const rateLimits = {};
  const modelScoped = [];

  for (const limit of body.limits) {
    if (!limit || typeof limit.percent !== 'number') {
      continue;
    }
    const window = { utilization: limit.percent, resets_at: limit.resets_at };

    if (limit.kind === 'session') {
      rateLimits.five_hour = window;
    } else if (limit.kind === 'weekly_all') {
      rateLimits.seven_day = window;
    } else if (limit.kind === 'weekly_scoped') {
      const name = limit.scope && limit.scope.model && limit.scope.model.display_name;
      if (name) {
        modelScoped.push(Object.assign({ display_name: name }, window));
      }
    }
  }

  if (modelScoped.length > 0) {
    rateLimits.model_scoped = modelScoped;
  }
  if (Object.keys(rateLimits).length === 0) {
    return null;
  }
  return { rate_limits: rateLimits };
}

module.exports = { payloadFromUsageApi };
