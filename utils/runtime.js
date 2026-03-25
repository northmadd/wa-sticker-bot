const getRuntimeInfo = () => {
  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GIT_COMMIT_SHA ||
    "";
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID || "";

  return {
    commit,
    deploymentId
  };
};

const getRuntimeLabel = () => {
  const { commit, deploymentId } = getRuntimeInfo();
  const shortCommit = commit ? commit.slice(0, 7) : "local";

  if (deploymentId) {
    return `${shortCommit}/${deploymentId.slice(0, 8)}`;
  }

  return shortCommit;
};

module.exports = {
  getRuntimeInfo,
  getRuntimeLabel
};
