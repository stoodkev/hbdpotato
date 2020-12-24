const express = require("express");
const router = new express.Router();
const hive = require("@hiveio/hive-js");
const dhive = require("@hiveio/dhive");
const axios = require('axios').default;
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

const validators = [{
  ip: 'https://hbdpotato.fbslo.net/'
}]
const apiKey = process.env.API_KEY
const useValidator = true

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
  const initialSBD = account[0].hbd_balance;
  const steemBalance = account[0].balance.split(" ")[0];
  if (parseFloat(steemBalance) !== 0) {
    const amountBuy = `${Math.min(parseFloat(steemBalance), MAX_BUY).toFixed(
      3
    )} HIVE`;
    console.log(`Buying ${amountBuy} worth of HBD.`);
    const orderID = getID();
    const expirationNum = parseInt(new Date().getTime() / 1000 + 10);

    const order = await prepareTransaction({
      type: 'order',
      owner: ACCOUNT,
      requestId: orderID,
      amount_to_sell: amountBuy,
      min_to_receive: "0.001 HBD",
      fill_or_kill: true,
      expirationNum: expirationNum
    })
    requestSignatures(order, account)

    await timeout(5000);
    account = await hive.api.getAccountsAsync([ACCOUNT]);
    console.log(
      `Bought ${parseFloat(account[0].hbd_balance) -
        parseFloat(initialSBD)} HBD for ${amountBuy}.`
    );
  } else console.log("No HIVE to buy HBD.");
  const sbd = account[0].hbd_balance;
  if (parseFloat(sbd) !== 0) {

    const convert = await prepareTransaction({
      type: 'convert',
      owner: ACCOUNT,
      requestId: getID(),
      amount: sbd
    })
    requestSignatures(convert, account)

    console.log(`Started conversion of ${sbd}.`);
  } else console.log("Nothing to convert!");
};

const getID = () => Math.floor(Math.random() * 10000000);

async function requestSignatures(transaction, account){
  console.log(transaction)
  if (useValidator){
    let signatures = []
    for (i in validators){
      axios.post(validators[i].ip, {
        apiKey: apiKey,
        transaction: transaction
      }).then((response) => {
        let { error, signature } = response.data
        if (!error){
          signatures.push(signature)
        }
      })
    }
    await timeout(5000);
    let threshold = Math.ceil(account[0].active.account_auths.length + account[0].active.key_auths.length * 0.75) //threshold at 75%
    if (signatures.length >= threshold){
      transaction["signatures"] = signatures
      console.log(transaction)
      hive.api.broadcastTransactionSynchronous(transaction, function(err, result) {
        if (err) console.log(err);
      });
    } else {
      console.log(`Not enough signatures collected`)
    }
  } else {
    await hive.broadcast.sendAsync({transaction, extensions: []}, [WIF]);
  }
}

async function prepareTransaction({type, owner, requestId, amount, amount_to_sell, min_to_receive, fill_or_kill, expirationNum}){
  let dhiveClient = new dhive.Client(['https://api.hive.blog', 'https://anyx.io', 'rpc.esteem.app', 'api.openhive.network'], {
    chainId: 'beeab0de00000000000000000000000000000000000000000000000000000000',
  })
  let expireTime = 1000 * 3590;
  let props = await dhiveClient.database.getDynamicGlobalProperties();
  let ref_block_num = props.head_block_number & 0xFFFF;
  let ref_block_prefix = Buffer.from(props.head_block_id, 'hex').readUInt32LE(4);
  let expiration = new Date(Date.now() + expireTime).toISOString().slice(0, -5);
  let extensions = [];
  let operation;
  if (type == 'convert'){
    operations = [['convert',
     {'owner': owner,
      'requestid': requestId,
      'amount': amount}]];
  } else {
    operations = [['limit_order_create',
     {'owner': owner,
      'orderid': requestId,
      'amount_to_sell': amount_to_sell,
      'min_to_receive': min_to_receive,
      'fill_or_kill': fill_or_kill,
      'expiration': expiration //expirationNum
    }]];
  }
console.log(operations)
  let tx = {
    expiration,
    extensions,
    operations,
    ref_block_num,
    ref_block_prefix
  }
  return tx;
}

module.exports = router;
