// utils/responseFormatter.js
export const formatResponse = (
  success,
  data = null,
  message = "",
  meta = {}
) => {
  return {
    success,
    data,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
};

export default { formatResponse };
