# x-client-transaction-id: twitter's api greatest mystery

i believe this to be the reason why automated logins fail more often
the implementation in this file most likely doesn't work properly (LLM based); will look into it later

- https://x.com/faa0311/status/1868247311379558621
- https://social.treehouse.systems/@dcnick3/112846737210886424
- https://web.archive.org/web/20241206000856/https://antibot.blog/twitter-header-part-3/
- https://blog.nest.moe/posts/twitter-header-part-4
- https://zhuanlan.zhihu.com/p/15101309732
- https://github.com/fa0311/twitter-tid-deobf-fork

implementations

- https://github.com/dimdenGD/OldTweetDeck/blob/ec304d307ef39ffce89c0d275a7e8d7a3774ef83/src/interception.js#L1919
- https://github.com/dimdenGD/OldTwitter/blob/06938a13873d232595d29e74fc42f8f8ace2615f/scripts/twchallenge.js#L124
- https://github.com/iSarabjitDhiman/XClientTransaction
  - https://github.com/iSarabjitDhiman/TweeterPy/tree/6f127c7095bf4be583728f191ce6d42de0461628/tweeterpy/tid
- https://github.com/imperatrona/twitter-scraper/blob/f5a2629e42386a3e5140881a2ab1a6fae7b34e51/auth.go#L25

very interestingly (?) they seem to have changed the string at some point (it's below)
to "ofbiowerehiring", obviously referring to the obfio user/person who wrote the first antibot.blog
articles. after that, their posts and repos have been taken down ;) maybe they were hired?

## other links

- https://github.com/fa0311/TwitterInternalAPIDocument
