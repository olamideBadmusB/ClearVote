 
;; ClearVote Voter Registry Contract
;; Clarity v2 (assuming latest syntax as of 2025)
;; Implements voter registration, verification, updates, revocation, and admin/official controls
;; Sophisticated with roles for officials, status tracking, timestamps, and events

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-ALREADY-REGISTERED u101)
(define-constant ERR-NOT-REGISTERED u102)
(define-constant ERR-INVALID-STATUS u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-ZERO-ADDRESS u105)
(define-constant ERR-INVALID-ID u106)
(define-constant ERR-NOT-ELIGIBLE u107)
(define-constant ERR-EXPIRED-REGISTRATION u108)

;; Voter status enums (using uint for simplicity)
(define-constant STATUS-PENDING u0)
(define-constant STATUS-APPROVED u1)
(define-constant STATUS-REVOKED u2)

;; Admin and contract state
(define-data-var admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var next-voter-id uint u1) ;; Auto-incrementing ID starting from 1

;; Maps
(define-map authorized-officials principal bool) ;; Officials who can approve/revoke
(define-map voters principal 
  {
    id: uint,
    eligibility: bool,
    registration-block: uint,
    status: uint,
    metadata-hash: (buff 32) ;; Hash of additional metadata (e.g., ID proof)
  }
)
(define-map voter-ids uint principal) ;; Reverse map for ID to principal

;; Events (using print for logging)
(define-private (emit-event (event-name (string-ascii 32)) (data (tuple)))
  (print { event: event-name, data: data })
)

;; Private helper: is-admin
(define-private (is-admin)
  (is-eq tx-sender (var-get admin))
)

;; Private helper: is-official
(define-private (is-official (account principal))
  (default-to false (map-get? authorized-officials account))
)

;; Private helper: is-authorized (admin or official)
(define-private (is-authorized)
  (or (is-admin) (is-official tx-sender))
)

;; Private helper: ensure not paused
(define-private (ensure-not-paused)
  (asserts! (not (var-get paused)) (err ERR-PAUSED))
)

;; Private helper: get-current-block
(define-private (get-current-block)
  (unwrap-panic (get-block-info? block-height u0))
)

;; Transfer admin rights
(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq new-admin tx-sender)) (err ERR-ZERO-ADDRESS)) ;; Prevent self-transfer, but allow any non-zero
    (var-set admin new-admin)
    (emit-event "admin-transferred" { new-admin: new-admin })
    (ok true)
  )
)

;; Pause/unpause the contract
(define-public (set-paused (pause bool))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (var-set paused pause)
    (emit-event "paused-set" { paused: pause })
    (ok pause)
  )
)

;; Add authorized official
(define-public (add-official (official principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq official tx-sender)) (err ERR-ZERO-ADDRESS))
    (map-set authorized-officials official true)
    (emit-event "official-added" { official: official })
    (ok true)
  )
)

;; Remove authorized official
(define-public (remove-official (official principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (map-delete authorized-officials official)
    (emit-event "official-removed" { official: official })
    (ok true)
  )
)

;; Register voter (initially pending, by voter themselves or official)
(define-public (register-voter (metadata-hash (buff 32)))
  (begin
    (ensure-not-paused)
    (asserts! (is-none (map-get? voters tx-sender)) (err ERR-ALREADY-REGISTERED))
    (let (
      (new-id (var-get next-voter-id))
      (current-block (get-current-block))
    )
      (map-set voters tx-sender 
        {
          id: new-id,
          eligibility: false, ;; Initially not eligible until approved
          registration-block: current-block,
          status: STATUS-PENDING,
          metadata-hash: metadata-hash
        }
      )
      (map-set voter-ids new-id tx-sender)
      (var-set next-voter-id (+ new-id u1))
      (emit-event "voter-registered" { voter: tx-sender, id: new-id, status: STATUS-PENDING })
      (ok new-id)
    )
  )
)

;; Approve voter (set eligible and approved)
(define-public (approve-voter (voter principal))
  (begin
    (ensure-not-paused)
    (asserts! (is-authorized) (err ERR-NOT-AUTHORIZED))
    (match (map-get? voters voter)
      voter-data
      (begin
        (asserts! (is-eq (get status voter-data) STATUS-PENDING) (err ERR-INVALID-STATUS))
        (map-set voters voter (merge voter-data { eligibility: true, status: STATUS-APPROVED }))
        (emit-event "voter-approved" { voter: voter, id: (get id voter-data) })
        (ok true)
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

;; Revoke voter
(define-public (revoke-voter (voter principal))
  (begin
    (ensure-not-paused)
    (asserts! (is-authorized) (err ERR-NOT-AUTHORIZED))
    (match (map-get? voters voter)
      voter-data
      (begin
        (asserts! (not (is-eq (get status voter-data) STATUS-REVOKED)) (err ERR-INVALID-STATUS))
        (map-set voters voter (merge voter-data { eligibility: false, status: STATUS-REVOKED }))
        (emit-event "voter-revoked" { voter: voter, id: (get id voter-data) })
        (ok true)
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

;; Update metadata hash (by voter or official)
(define-public (update-metadata (new-hash (buff 32)))
  (begin
    (ensure-not-paused)
    (match (map-get? voters tx-sender)
      voter-data
      (begin
        (asserts! (or (is-authorized) (is-eq tx-sender tx-sender)) (err ERR-NOT-AUTHORIZED)) ;; Voter can update own
        (map-set voters tx-sender (merge voter-data { metadata-hash: new-hash }))
        (emit-event "metadata-updated" { voter: tx-sender, id: (get id voter-data) })
        (ok true)
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

;; Check if voter is eligible to vote (approved and not revoked)
(define-read-only (is-eligible (voter principal))
  (match (map-get? voters voter)
    voter-data
    (ok (and (get eligibility voter-data) (is-eq (get status voter-data) STATUS-APPROVED)))
    (err ERR-NOT-REGISTERED)
  )
)

;; Get voter details
(define-read-only (get-voter-details (voter principal))
  (ok (map-get? voters voter))
)

;; Get voter by ID
(define-read-only (get-voter-by-id (id uint))
  (let ((voter (map-get? voter-ids id)))
    (match voter
      v (get-voter-details v)
      (err ERR-INVALID-ID)
    )
  )
)

;; Get next ID (for info)
(define-read-only (get-next-id)
  (ok (var-get next-voter-id))
)

;; Get admin
(define-read-only (get-admin)
  (ok (var-get admin))
)

;; Check if paused
(define-read-only (is-paused)
  (ok (var-get paused))
)

;; Check if official
(define-read-only (is-official-read (account principal))
  (ok (is-official account))
)

;; Additional robust function: Batch approve voters
(define-public (batch-approve (voters-list (list 100 principal)))
  (begin
    (ensure-not-paused)
    (asserts! (is-authorized) (err ERR-NOT-AUTHORIZED))
    (fold batch-approve-fold voters-list (ok u0))
  )
)

(define-private (batch-approve-fold (voter principal) (count-res (response uint uint)))
  (match count-res
    count
    (match (approve-voter voter)
      success (ok (+ count u1))
      error (ok count) ;; Skip errors, continue
    )
    error (err error)
  )
)

;; Similar for batch revoke
(define-public (batch-revoke (voters-list (list 100 principal)))
  (begin
    (ensure-not-paused)
    (asserts! (is-authorized) (err ERR-NOT-AUTHORIZED))
    (fold batch-revoke-fold voters-list (ok u0))
  )
)

(define-private (batch-revoke-fold (voter principal) (count-res (response uint uint)))
  (match count-res
    count
    (match (revoke-voter voter)
      success (ok (+ count u1))
      error (ok count) ;; Skip
    )
    error (err error)
  )
)

;; Function to check if registration is recent (e.g., not expired, arbitrary logic)
(define-read-only (is-registration-valid (voter principal) (max-blocks uint))
  (match (map-get? voters voter)
    voter-data
    (let ((current (unwrap-panic (get-block-info? block-height u0))))
      (ok (<= (- current (get registration-block voter-data)) max-blocks))
    )
    (err ERR-NOT-REGISTERED)
  )
)

;; More sophistication: Allow voter to self-revoke
(define-public (self-revoke)
  (begin
    (ensure-not-paused)
    (match (map-get? voters tx-sender)
      voter-data
      (begin
        (map-set voters tx-sender (merge voter-data { eligibility: false, status: STATUS-REVOKED }))
        (emit-event "voter-self-revoked" { voter: tx-sender, id: (get id voter-data) })
        (ok true)
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

;; Admin function to reset next-id if needed (emergency)
(define-public (reset-next-id (new-id uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-id (var-get next-voter-id)) (err ERR-INVALID-ID)) ;; Only increase
    (var-set next-voter-id new-id)
    (emit-event "next-id-reset" { new-id: new-id })
    (ok true)
  )
)