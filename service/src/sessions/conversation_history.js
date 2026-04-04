export function trimConversationHistoryForFollowup(history, isFollowup) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }
  return isFollowup ? history : [];
}
