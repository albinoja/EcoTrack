<script setup>
import { displayDate } from "../helpers/date";
import { formatCurrency } from "../helpers";
import { useAppointmentsStore } from "../stores/appointments";
const appointments = useAppointmentsStore();

defineProps({
  appointment: {
    type: Object,
  },
});
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow-md space-y-4">
    <!-- Fecha y Hora -->
    <div class="flex justify-between items-center text-gray-600">
      <p class="text-sm font-semibold">
        Fecha:
        <span class="font-normal text-gray-500"> {{ displayDate(appointment.date) }} </span>
      </p>
      <p class="text-sm font-semibold">
        Hora:
        <span class="font-normal text-gray-500"> {{ appointment.time }} Horas</span>
      </p>
    </div>

    <!-- Servicio solicitado -->
    <div>
      <p class="text-xl font-bold text-gray-800 mt-2">Servicio Solicitado:</p>
      <p class="text-lg text-gray-700 mt-1">{{ appointment.name }}</p>
    </div>

    <!-- Total a pagar -->
    <div class="flex justify-end mt-4">
      <p class="text-xl font-semibold text-gray-900">
        Total a pagar:
        <span class="text-2xl font-bold text-blue-600">
          {{ formatCurrency(appointment.total_amount) }}
        </span>
      </p>
    </div>

    <!-- Botones de acción -->
    <div class="flex gap-4 mt-6">
      <!-- Editar Cita -->
      <RouterLink
        :to="{ name: 'edit-appointment', params: { id: appointment.id } }"
        class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-3 px-6 rounded-lg font-semibold uppercase transition-colors duration-300 flex-1 md:flex-none"
      >
        Editar Cita
      </RouterLink>

      <!-- Cancelar Cita -->
      <button
        class="bg-red-600 hover:bg-red-700 text-white text-sm py-3 px-6 rounded-lg font-semibold uppercase transition-colors duration-300 flex-1 md:flex-none"
        @click="appointments.cancelAppointment(appointment.id)"
      >
        Cancelar Cita
      </button>
    </div>
  </div>
</template>
