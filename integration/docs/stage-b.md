# Stage B — process and browser peers

Stage A runs every peer in-process (`HostLevel` `L1`, `inProcessHost`).
Stage B adds two hosts behind the same `SimDriver` and scenario DSL.
No L2 or L3 code ships in this stage.

## PeerHost

```ts
interface PeerHost {
  readonly level: 'L1' | 'L2' | 'L3';
  supports(feature: 'restartServer' | 'browserReload'): boolean;
}
```

`MatchHandle.createPeer` asks the host for a runner. L1 constructs a
`MatchRunner` in this process. L2 and L3 return a proxy peer whose
`step`, `snapshot`, `restore`, `fastForward` and `digest` are messages.

## L2 — child process and chaos proxy

One child runs the relay (or SimHost). Each peer is a child that
speaks the existing client transport. A chaos proxy sits on the TCP
path and applies the same `FaultGate` probabilities the in-process
interpreter uses today (delay, duplicate, reorder, drop). Drop still
means the peer catches up from the authoritative log once the range
ends.

`restartServer` is the L2 operation that kills the relay child and
starts a new one. Clients keep their player ids, take a fresh
snapshot from a surviving peer (or from the new server, once it has
one), and `fastForward` the log tail. The DSL event already exists.
The interpreter skips it while `capabilities.restartServer` is false.
An L2 driver sets that flag and handles the event.

`replaceWithBot` / `returnFromBot` stay skipped until the runner grows
`setController`. The host does not invent that API.

## L3 — browser peers

Playwright opens one page per peer. The page loads the same game
bundle and speaks to the L2 relay. `browserReload` closes the page,
opens a new one, and drives `reconnect` (`via: 'snapshot'` or
`via: 'log'`) through the existing events. Digests are read from the
page (`digest` over a bridge), never from DOM state.

Pause and resume stay virtual-clock operations. The proxy and the
browser do not advance a peer that the scenario has paused.

## What does not change

Scenarios, the oracle, the fuzzer, the report and the skirmish rules
stay on `SimDriver`. An L2 or L3 adapter implements that interface and
sets the capability flags. Conformance tests are the acceptance.
