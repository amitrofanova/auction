<script setup lang="ts">
import { PARTICIPANTS, type ParticipantId } from '@auction/shared'
import { computed, ref, watch } from 'vue'
import { formatClock, formatRemaining, formatRubles } from './format'
import { useAuction } from './useAuction'

const {
  participantId,
  view,
  status,
  banner,
  sending,
  bidError,
  brokerError,
  you,
  minimum,
  leaderIsMe,
  timerLabel,
  placeBid,
  setAutobroker,
  removeAutobroker,
  switchParticipant,
} = useAuction()

const amountInput = ref('')
const brokerInput = ref('20000')

watch(
  minimum,
  (value) => {
    amountInput.value = String(value)
  },
  { immediate: true },
)

const leaderName = computed(() =>
  view.value.leader ? PARTICIPANTS[view.value.leader.participantId] : '—',
)
const leaderAmount = computed(() => (view.value.leader ? String(view.value.leader.amount) : ''))
const leaderAmountLabel = computed(() =>
  view.value.leader ? formatRubles(view.value.leader.amount) : '—',
)
const timerText = computed(() =>
  typeof timerLabel.value === 'number' ? formatRemaining(timerLabel.value) : timerLabel.value,
)
const onlineNames = computed(() => view.value.onlineParticipantIds.map((id) => PARTICIPANTS[id]).join(', '))
const brokerLabel = computed(() =>
  view.value.autobroker ? `Включён, потолок ${formatRubles(view.value.autobroker.maxAmount)}` : 'Выключен',
)
const closed = computed(() => view.value.stage === 'closed')
const canSend = computed(() => view.value.ready && !closed.value && !sending.value)

function onParticipant(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if ((value === 'a' || value === 'b') && value !== participantId.value) {
    switchParticipant(value as ParticipantId)
  }
}

function onSubmitBid() {
  placeBid(Number(amountInput.value))
}

function onEnableBroker() {
  setAutobroker(Number(brokerInput.value))
}
</script>

<template>
  <main class="lot" :data-stage="view.stage">
    <header class="head">
      <div>
        <p class="eyebrow">Один лот</p>
        <h1 data-testid="lot-title">Демо-лот</h1>
      </div>
      <label class="who">
        Участник
        <select data-testid="participant" :value="participantId" @change="onParticipant">
          <option value="a">Алексей</option>
          <option value="b">Марина</option>
        </select>
      </label>
    </header>

    <p class="status" :data-status="status">
      Соединение:
      <strong data-testid="connection">{{ status }}</strong>
    </p>
    <p v-if="banner" data-testid="recovery-banner" class="banner">{{ banner }}</p>

    <section class="board">
      <div>
        <span>Лидер</span>
        <strong data-testid="leader-name">{{ leaderName }}</strong>
      </div>
      <div>
        <span>Сумма</span>
        <strong data-testid="leader-amount" :data-amount="leaderAmount">{{ leaderAmountLabel }}</strong>
      </div>
      <div>
        <span>Шаг</span>
        <strong data-testid="min-step" :data-step="view.minStep">{{ formatRubles(view.minStep) }}</strong>
      </div>
      <div>
        <span>До конца</span>
        <strong data-testid="timer" :data-ends-at="view.endsAt">{{ timerText }}</strong>
      </div>
    </section>

    <p class="meta">
      Вы — <span data-testid="you">{{ you }}</span>.
      Начальная цена {{ formatRubles(view.startingPrice) }}.
      <template v-if="closed"> Лот закрыт.</template>
    </p>
    <p v-if="leaderIsMe && !closed" class="hint">Сейчас лидируете вы. Перебить может только другой участник.</p>

    <section class="panel">
      <h2>Ставка</h2>
      <form class="row" @submit.prevent="onSubmitBid">
        <label>
          Сумма, ₽
          <input
            data-testid="bid-amount"
            v-model="amountInput"
            inputmode="numeric"
            autocomplete="off"
            :disabled="!view.ready || closed"
          />
        </label>
        <button data-testid="bid-submit" type="submit" :disabled="!canSend">
          {{ sending ? 'Отправляем' : 'Поставить' }}
        </button>
      </form>
      <p class="hint">Следующая допустимая: {{ formatRubles(minimum) }}</p>
      <p v-if="bidError" data-testid="bid-error" class="error">{{ bidError }}</p>
    </section>

    <section class="panel">
      <h2>Автоброкер</h2>
      <p data-testid="broker-status">{{ brokerLabel }}</p>
      <div class="row">
        <label>
          Потолок, ₽
          <input
            data-testid="broker-max"
            v-model="brokerInput"
            inputmode="numeric"
            autocomplete="off"
            :disabled="!view.ready || closed"
          />
        </label>
        <button data-testid="broker-on" type="button" :disabled="!view.ready || closed" @click="onEnableBroker">
          Включить
        </button>
        <button data-testid="broker-off" type="button" :disabled="!view.ready || closed" @click="removeAutobroker">
          Выключить
        </button>
      </div>
      <p v-if="brokerError" data-testid="broker-error" class="error">{{ brokerError }}</p>
    </section>

    <section class="panel">
      <h2>Лента ставок</h2>
      <p class="counters">
        <span data-testid="bid-count" :data-count="view.bids.length">Ставок: {{ view.bids.length }}</span>
        <span data-testid="online-count" :data-count="view.onlineParticipantIds.length">
          Участники онлайн: {{ view.onlineParticipantIds.length }}
          <template v-if="onlineNames"> · {{ onlineNames }}</template>
        </span>
      </p>
      <p v-if="view.bids.length === 0" class="hint">Ставок пока нет</p>
      <ol v-else data-testid="bid-list" class="feed">
        <li v-for="bid in view.bids" :key="bid.seq">
          <span class="seq">#{{ bid.seq }}</span>
          <span class="name">{{ bid.participantName }}</span>
          <span class="sum">{{ formatRubles(bid.amount) }}</span>
          <span class="source">{{ bid.source === 'autobroker' ? 'авто' : 'вручную' }}</span>
          <time>{{ formatClock(bid.at) }}</time>
        </li>
      </ol>
    </section>

    <p class="foot">Сервер — источник правды. Сумма лидера меняется только после принятой ставки.</p>
  </main>
</template>
