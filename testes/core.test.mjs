import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,limitValue,messageFor,validateLead} from '../extensao/engine.js';
test('Normaliza marcadores',()=>assert.equal(normalize('- Item'),normalize('• Item')));
test('Limite positivo aceito',()=>assert.equal(limitValue('2'),2));
test('Limite vazio rejeitado',()=>assert.throws(()=>limitValue('')));
test('Limite fracionário rejeitado',()=>assert.throws(()=>limitValue('1.5')));
test('Preserva interesse informado',()=>assert(messageFor('Série exemplo').includes('Série exemplo')));
test('Contato vazio rejeitado',()=>assert.throws(()=>validateLead({phone:'',interest:'',message:''})));
