# csv-reader-speed-01-mellow-condor-47

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/bongekanjing/csv-reader-speed-01-mellow-condor-47/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/bongekanjing/csv-reader-speed-01-mellow-condor-47/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: `run(input)` returns exactly the answer
csv-reader 1.0.0 returns for the same input, in a little over a third of its CPU
time.

## What changed

csv-reader 1.0.0 walks the text one character at a time. Every character becomes
its own one-character string, which is concatenated onto the field being built,
and every field's ending is handed back as a freshly allocated object. Both costs
fall on every character and every field of a 10 MB file.

This reader keeps the reading and changes only how the work is done:

- it scans a run of ordinary characters with `charCodeAt` and takes the whole run
  out as one `slice`, so a field costs one slice instead of one string per
  character;
- it reports each field's ending through a variable of the parser's own rather
  than an object per field;
- a field with a single run and no base is the `slice` itself, never an empty
  string with the run appended, so the answer's strings stay flat for the
  serializer that reads them next.

The policy is unchanged in every detail the rules name: the U+FEFF at the start,
LF and CRLF records with an empty line being no record, a stray CR outside quotes
being dropped (`stray_cr`), the quoted field read to its next undoubled quote with
`""` as one quote and every CRLF or lone CR inside it as LF, the text after a
closing quote appended as it stands (`quote_junk`), a quote that never closes
being a literal character with the text after it read again as unquoted
(`unterminated_quote`), a quote inside an unquoted field being a literal
character, fields never trimmed or converted, `columns` the first record when
`header` is true and null otherwise, and each row padded (`short_row`) or cut
(`long_row`) to the first record's width, with every error `{code, line, row}` in
the order met.

## Verified

Every one of the six practice cases answers byte-identically to
`practice/reference/expected.json`, compared as JSON values with objects matched
by key set and arrays in order.

Whole-process CPU, measured the way the judge measures it, `getrusage` of the
child over five runs with the fastest and slowest dropped:

    csv-reader 1.0.0 (house baseline)   2,004,440 us
    this entry                            777,392 us

That is 2.58x the house baseline's speed on the practice set.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mellow-condor-47&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
