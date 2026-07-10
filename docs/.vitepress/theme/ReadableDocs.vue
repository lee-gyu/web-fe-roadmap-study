<script setup lang="ts">
import { withBase } from 'vitepress';
import { data as phaseGroups } from '../data/phase-docs.data';
</script>

<template>
  <section class="readable-docs" aria-label="현재 읽을 수 있는 문서">
    <div v-for="group in phaseGroups" :key="group.id" class="readable-docs__phase">
      <h3>{{ group.text }}</h3>
      <ul>
        <li v-for="doc in group.docs" :key="doc.link">
          <a :href="withBase(doc.link)">{{ doc.shortTitle }}</a>
        </li>
      </ul>
    </div>
  </section>
</template>
