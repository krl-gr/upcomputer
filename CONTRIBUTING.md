# Contributing

Thanks for wanting to help. Up.computer has one maintainer, so this page says what is easy for me
to review and what is not.

## Developer setup

See the [development runbook](docs/operations/development.md#first-checkout) for the initial checkout,
development commands, tests, and platform-specific desktop packaging prerequisites.

## Report a bug

Bug reports are welcome. Open an issue with the **Bug report** form on
[GitHub](https://github.com/krl-gr/upcomputer/issues).

- Search existing issues first.
- Keep each report to one problem.
- Include the app version, your OS, the agent you used, and the steps to reproduce.
- Screenshots or a short video help when the problem is visual.

## Suggest a feature

Focused feedback and ideas are welcome. Use the **Feature request** form, and describe the problem
you want solved, not only the solution. Small, concrete requests are the easiest to act on.

## Pull requests

Focused fixes are welcome: bug fixes, reliability fixes, performance improvements and docs fixes.

<a id="prior-approval"></a>

### Open an issue before large work

A small fix for an obvious bug needs no issue. For anything larger, open an issue first. That
includes new features, UI changes, new providers and changes to the architecture. We can agree on
the scope before you spend time on a branch. A large pull request that arrives without an agreed
issue is likely to be closed. Link the issue in your pull request.

<a id="one-problem"></a>

### One problem per pull request

Fix one problem. Include every change that fix needs, across contracts, server, clients, tests and
docs. Cleanup, refactors and a second fix go in their own pull requests.

<a id="verification"></a>

### Show that it works

Say what changed and why, how you checked it, and what you saw. "Tests pass" alone is not enough.

- Add tests for logic you changed, where it makes sense.
- Add before and after screenshots for any UI change.
- Add a short video if the change involves motion, timing or interaction.

Upload screenshots and videos to the pull request. Do not commit them.

### What happens next

Pull requests are labeled automatically with a `size:*` label for the diff size and a `vouch:*`
trust status. Expect `vouch:unvouched` until you are added to
[.github/VOUCHED.td](.github/VOUCHED.td). That only means I have not worked with you yet.

I review as time allows. I may ask you to shrink a change, or implement the idea differently
myself.

<a id="closure-and-reconsideration"></a>

### If I close your pull request

I will say which rule it broke and what would fix it, such as splitting it or opening an issue
first. Once that is done, you are welcome to open it again or ask me to reopen it.

## Security issues

Do not report security problems in a public issue. Email **support@up.computer** instead. See
[SECURITY.md](.github/SECURITY.md) for what to include.
