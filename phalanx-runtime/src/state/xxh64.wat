;; XXH64, seed 0. Input is the exported memory at offset 0.
;; Build with scripts/build-xxh64-wasm.mjs (wabt). The package build
;; embeds the bytes and does not run this toolchain.
(module
  (memory (export "memory") 1)
  (func $round (param $acc i64) (param $input i64) (result i64)
    (i64.mul
      (i64.rotl
        (i64.add
          (local.get $acc)
          (i64.mul (local.get $input) (i64.const 0xC2B2AE3D27D4EB4F)))
        (i64.const 31))
      (i64.const 0x9E3779B185EBCA87)))
  (func $merge (param $acc i64) (param $val i64) (result i64)
    (i64.add
      (i64.mul
        (i64.xor
          (local.get $acc)
          (call $round (i64.const 0) (local.get $val)))
        (i64.const 0x9E3779B185EBCA87))
      (i64.const 0x85EBCA77C2B2AE63)))
  (func (export "xxh64") (param $len i32) (result i64)
    (local $p i32)
    (local $end i32)
    (local $h i64)
    (local $v1 i64)
    (local $v2 i64)
    (local $v3 i64)
    (local $v4 i64)
    (if (i32.ge_u (local.get $len) (i32.const 32))
      (then
        (local.set $v1
          (i64.add
            (i64.const 0x9E3779B185EBCA87)
            (i64.const 0xC2B2AE3D27D4EB4F)))
        (local.set $v2 (i64.const 0xC2B2AE3D27D4EB4F))
        (local.set $v3 (i64.const 0))
        (local.set $v4
          (i64.sub (i64.const 0) (i64.const 0x9E3779B185EBCA87)))
        (local.set $end (i32.sub (local.get $len) (i32.const 32)))
        (loop $stripes
          (local.set $v1
            (call $round
              (local.get $v1)
              (i64.load align=1 (local.get $p))))
          (local.set $p (i32.add (local.get $p) (i32.const 8)))
          (local.set $v2
            (call $round
              (local.get $v2)
              (i64.load align=1 (local.get $p))))
          (local.set $p (i32.add (local.get $p) (i32.const 8)))
          (local.set $v3
            (call $round
              (local.get $v3)
              (i64.load align=1 (local.get $p))))
          (local.set $p (i32.add (local.get $p) (i32.const 8)))
          (local.set $v4
            (call $round
              (local.get $v4)
              (i64.load align=1 (local.get $p))))
          (local.set $p (i32.add (local.get $p) (i32.const 8)))
          (br_if $stripes (i32.le_u (local.get $p) (local.get $end)))
        )
        (local.set $h
          (i64.add
            (i64.add
              (i64.rotl (local.get $v1) (i64.const 1))
              (i64.rotl (local.get $v2) (i64.const 7)))
            (i64.add
              (i64.rotl (local.get $v3) (i64.const 12))
              (i64.rotl (local.get $v4) (i64.const 18)))))
        (local.set $h (call $merge (local.get $h) (local.get $v1)))
        (local.set $h (call $merge (local.get $h) (local.get $v2)))
        (local.set $h (call $merge (local.get $h) (local.get $v3)))
        (local.set $h (call $merge (local.get $h) (local.get $v4)))
      )
      (else
        (local.set $h (i64.const 0x27D4EB2F165667C5))
      ))
    (local.set $h
      (i64.add (local.get $h) (i64.extend_i32_u (local.get $len))))
    (block $done8
      (loop $lane8
        (br_if $done8
          (i32.gt_u (i32.add (local.get $p) (i32.const 8)) (local.get $len)))
        (local.set $h
          (i64.add
            (i64.mul
              (i64.rotl
                (i64.xor
                  (local.get $h)
                  (call $round
                    (i64.const 0)
                    (i64.load align=1 (local.get $p))))
                (i64.const 27))
              (i64.const 0x9E3779B185EBCA87))
            (i64.const 0x85EBCA77C2B2AE63)))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $lane8)
      )
    )
    (if (i32.le_u (i32.add (local.get $p) (i32.const 4)) (local.get $len))
      (then
        (local.set $h
          (i64.xor
            (local.get $h)
            (i64.mul
              (i64.extend_i32_u (i32.load align=1 (local.get $p)))
              (i64.const 0x9E3779B185EBCA87))))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))
        (local.set $h
          (i64.add
            (i64.mul
              (i64.rotl (local.get $h) (i64.const 23))
              (i64.const 0xC2B2AE3D27D4EB4F))
            (i64.const 0x165667B19E3779F9)))
      ))
    (block $done1
      (loop $lane1
        (br_if $done1 (i32.ge_u (local.get $p) (local.get $len)))
        (local.set $h
          (i64.xor
            (local.get $h)
            (i64.mul
              (i64.extend_i32_u (i32.load8_u (local.get $p)))
              (i64.const 0x27D4EB2F165667C5))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $h
          (i64.mul
            (i64.rotl (local.get $h) (i64.const 11))
            (i64.const 0x9E3779B185EBCA87)))
        (br $lane1)
      )
    )
    (local.set $h
      (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 33))))
    (local.set $h (i64.mul (local.get $h) (i64.const 0xC2B2AE3D27D4EB4F)))
    (local.set $h
      (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))))
    (local.set $h (i64.mul (local.get $h) (i64.const 0x165667B19E3779F9)))
    (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32)))
  )
)
