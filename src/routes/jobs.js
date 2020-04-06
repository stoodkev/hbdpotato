const express = require("express");
const router = new express.Router();
const hive = require("@hiveio/hive-js");
hive.api.setOptions({url: "https://anyx.io/"});
const {
  ACCOUNT,
  WIF,
  MAX_BUY,
  POSTS_PER_DAY,
  POSTING,
  MAX_ACCEPTED_SBD,
  COMMENTS_PER_POST,
  BENEFICIARY
} = process.env;
const auth = require("../middlewares/auth");
const {getPostBody, getTitle, tags} = require("../templates/post");

router.post("/convert", auth, (req, res) => {
  convert();
  res.sendStatus(200);
});

router.post("/post", auth, (req, res) => {
  if ((new Date().getHours() + 2) % (24 / POSTS_PER_DAY) === 0) post();
  res.sendStatus(200);
});

const post = async () => {
  console.log("starting post");
  const date = new Date()
    .toISOString()
    .split("T")[0]
    .replace(/-/g, "/");
  const iteration = Math.ceil(new Date().getHours() / (24 / POSTS_PER_DAY));
  console.log(iteration);
  const title = getTitle(`${date} #${iteration}`);
  console.log(title);
  const permlink =
    title
      .toLowerCase()
      .replace(/ /g, "-")
      .replace(/\//g, "-")
      .replace(/#/g, "") + Date.now();
  console.log(permlink);
  const json_metadata = {tags};
  const body = await getPostBody();

  console.log(body, json_metadata);
  const extensions = BENEFICIARY
    ? [[0, {beneficiaries: [{account: BENEFICIARY, weight: 10000}]}]]
    : [];
  console.log(tags[0], JSON.stringify(extensions));
  var operations = [
    [
      "comment",
      {
        parent_author: "",
        parent_permlink: tags[0],
        author: ACCOUNT,
        permlink: permlink,
        title: title,
        body: body,
        json_metadata: JSON.stringify({
          app: "sbdpotatobot",
          format: "markdown",
          tags
        })
      }
    ],
    [
      "comment_options",
      {
        author: ACCOUNT,
        permlink: permlink,
        max_accepted_payout: MAX_ACCEPTED_SBD,
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions
      }
    ]
  ];
  console.log(operations);
  await hive.broadcast.sendAsync({operations, extensions: []}, [POSTING]);
  for (let i = 1; i <= COMMENTS_PER_POST; i++) {
    await timeout(3000);
    operations = [
      [
        "comment",
        {
          parent_author: ACCOUNT,
          parent_permlink: permlink,
          author: ACCOUNT,
          title: `Additional vote #${i}`,
          permlink: `${permlink}re-${i}`,
          body: `Additional vote #${i}`,
          json_metadata: JSON.stringify({})
        }
      ],
      [
        "comment_options",
        {
          author: ACCOUNT,
          permlink: `${permlink}re-${i}`,
          max_accepted_payout: MAX_ACCEPTED_SBD,
          percent_steem_dollars: 10000,
          allow_votes: true,
          allow_curation_rewards: true,
          extensions
        }
      ]
    ];
    await hive.broadcast.sendAsync({operations, extensions: []}, [POSTING]);
  }
};

const timeout = ms => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const convert = async () => {
  let account = await hive.api.getAccountsAsync([ACCOUNT]);
  const initialSBD = account[0].sbd_balance;
  const steemBalance = account[0].balance;
  if (parseFloat(steemBalance) !== 0) {
    const amountBuy = `${Math.min(parseFloat(steemBalance), MAX_BUY).toFixed(
      3
    )} STEEM`;
    console.log(`Buying ${amountBuy} worth of HBD.`);
    const orderID = getID();
    const expiration = parseInt(new Date().getTime() / 1000 + 10);
    const order = await hive.broadcast.limitOrderCreateAsync(
      WIF,
      ACCOUNT,
      orderID,
      amountBuy,
      "0.001 SBD",
      true,
      expiration
    );
    await timeout(5000);
    account = await hive.api.getAccountsAsync([ACCOUNT]);
    console.log(
      `Bought ${parseFloat(account[0].sbd_balance) -
        parseFloat(initialSBD)} HBD for ${amountBuy}.`
    );
  } else console.log("No HIVE to buy HBD.");
  const sbd = account[0].sbd_balance;
  if (parseFloat(sbd) !== 0) {
    const convert = await hive.broadcast.convertAsync(
      WIF,
      ACCOUNT,
      getID(),
      sbd.replace("HBD", "SBD")
    );
    console.log(`Started conversion of ${sbd}.`);
  } else console.log("Nothing to convert!");
};

const getID = () => Math.floor(Math.random() * 10000000);

module.exports = router;
