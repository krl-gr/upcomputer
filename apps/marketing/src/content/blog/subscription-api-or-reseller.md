---
title: "Subscription, API or reseller: which AI tools are worth paying for"
description: Why a subscription from the company that makes the model beats API access and resellers for personal use and small teams, how big the subsidy really is, and when a subscription is the wrong choice.
date: 2026-11-04
draft: false
headings: run-in
---

For personal use and small teams, pay for a subscription from the company that makes the model, not for API access and not for a reseller. Subscriptions are subsidized, so you get many times more work for the same money. Resellers pay full API prices and pass them on to you with a margin.

Below is how to tell which one fits you.

## Who sells you AI.

- Provider. The company that builds the model and sets its prices and usage rules. OpenAI, Anthropic and Google are providers.
- Aggregator, or reseller. The company that buys access to many providers and resells it to you, usually with its own app on top. Perplexity, Cursor and OpenRouter work this way.

## How they sell you AI.

- API access. You pay for exactly what you use. Every token has a price, and you buy as many as you need. There are no usage limits beyond the rate limits, and you pay the full price.
- Subscription. You pay a fixed amount every month, for example $20, $100 or $200, and get limited access: a usage window that resets every few hours, plus a weekly cap.

The important part: subscriptions are subsidized. For the same money, a subscription gives you many times more than the API.

How much more depends on how hard you use it: typical reports land at 5 to 10 times the plan price, and one developer's heavy month on the $200 Claude Max plan would have cost $26,187 at API prices, 131 times more ([ml0x](https://ml0x.com/research/claude-max-vs-api-cost.html)).

### Why providers are this generous.

First, marketing. People who use a model every day at home bring it to work, and companies pay full API prices or enterprise contracts. It's the standard playbook: Notion and Linear give individuals a cheap or free plan and make their money on teams.

Second, most people don't use their whole limit. Two people pay $200. One uses 10% of the limit, the other runs agents all day and hits it every week. The light user pays for the heavy one. Gyms work the same way.

So don't expect subscriptions to stop being subsidized, and don't build your personal workflow on the API because of that fear. The discount will grow and shrink with the market, but it won't disappear.

## When to pick a subscription.

A subscription is right for personal use and small teams, when you use AI a lot. Use it through the provider's own apps and CLI, or through an app on top of the CLI, so the same subscription covers all your work.

Subscriptions have real downsides:

1. API customers come first. When servers are overloaded, we see subscription users hit errors and slowdowns before paying API customers do.
2. Your chats may train the model. On Claude Free, Pro and Max, chats are used for training unless you turn it off in privacy settings, and API and business plans are not used for training ([MacRumors](https://www.macrumors.com/2025/08/28/anthropic-claude-chat-training)). Other providers have similar settings. Check them, and don't put data there that you can't share. Turning training off doesn't make a personal plan private, though. Your chats are still stored: on Claude, 30 days with training off and 5 years with it on. And there's no contract behind it, only a setting the provider can change in its next policy update. A company also can't check which of its people turned it off.
3. If you use AI only a little, you overpay. A few questions a week costs less on the API.

## When to pick the API.

Turn training off, and a personal plan is fine for your own data. If a contract has to cover the data, like client data, medical or legal records, or company code under NDA, pick the API or a business plan: they come with a data processing agreement, limits on how long data is kept, and compliance paperwork like SOC 2. The same goes for very little use: the API is cheaper.

## When to pick an aggregator's subscription.

Aggregators buy API access from providers, just like you could. They pay the full API price and pass it on to you with a margin. There's no subsidy in the middle, so a $20 aggregator plan gets you far fewer questions than a $20 ChatGPT or Claude plan.

Some aggregators, like Cursor, use the same trick providers do: most users don't use their whole plan. They also route part of your work to cheaper models, including their own, to save money. A mix of an expensive model and a cheap one can really cost less. But for one person or a small team, $100 of a provider's plan still buys more than $100 at an aggregator that decides when to give you the good model.

So we pick an aggregator only to compare models: a well-known one, now and then.

Whichever you pick, subscription or API, provider or aggregator, you can use it in the Up.computer app. We don't resell tokens, we just add an interface to what you want to use.

New to AI tools? Start with [A short history of AI tools, and which one to use for what](/blog/short-history-of-ai-tools/).
