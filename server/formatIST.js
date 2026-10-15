// Shows a moment in Indian time, for example "15 Oct 2026, 10:40:12 am".
// Only for display: the UTC timestamp stays the source of truth.
function formatIST(date) {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

module.exports = formatIST;
