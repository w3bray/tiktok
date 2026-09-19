package com.w3bray.tiktokcleaner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Testes JVM puros: rodam no CI sem emulador e sem aparelho. */
class GeometryTest {

    private val screenWidth = 1080
    private val screenHeight = 2400

    private fun cell(column: Int, row: Int) = Box(
        left = column * 360,
        top = 600 + row * 480,
        right = column * 360 + 360,
        bottom = 600 + row * 480 + 480,
    )

    @Test
    fun `celula da grade ocupa cerca de um terco da largura`() {
        assertTrue(Geometry.isGridCell(cell(0, 0), screenWidth, screenHeight))
        assertTrue(Geometry.isGridCell(cell(2, 1), screenWidth, screenHeight))
    }

    @Test
    fun `botao pequeno nao e celula`() {
        val likeButton = Box(960, 1200, 1050, 1290)
        assertFalse(Geometry.isGridCell(likeButton, screenWidth, screenHeight))
    }

    @Test
    fun `banner largo nao e celula`() {
        val banner = Box(0, 600, 1080, 800)
        assertFalse(Geometry.isGridCell(banner, screenWidth, screenHeight))
    }

    @Test
    fun `topo da tela fica fora da grade`() {
        val header = Box(0, 40, 360, 500)
        assertFalse(Geometry.isGridCell(header, screenWidth, screenHeight))
    }

    @Test
    fun `celulas saem ordenadas e sem repeticao`() {
        val boxes = listOf(
            cell(2, 0),
            cell(0, 0),
            cell(0, 0), // container e filho com a mesma caixa
            cell(1, 0),
            cell(0, 1),
            Box(960, 1200, 1050, 1290), // botao, deve sair fora
        )

        val cells = Geometry.gridCells(boxes, screenWidth, screenHeight)

        assertEquals(4, cells.size)
        assertEquals(cell(0, 0), cells[0])
        assertEquals(cell(1, 0), cells[1])
        assertEquals(cell(2, 0), cells[2])
        assertEquals(cell(0, 1), cells[3])
    }

    @Test
    fun `shrink mantem o centro`() {
        val box = Box(0, 0, 100, 100)
        val inner = Geometry.shrink(box, 0.5)

        assertEquals(box.centerX, inner.centerX)
        assertEquals(box.centerY, inner.centerY)
        assertEquals(50, inner.width)
        assertEquals(50, inner.height)
    }

    @Test
    fun `reconhece o vermelho da marca`() {
        assertTrue(Geometry.isBrandRed(254, 44, 85))
        assertFalse(Geometry.isBrandRed(255, 255, 255)) // icone apagado
        assertFalse(Geometry.isBrandRed(22, 24, 35)) // fundo escuro
        assertFalse(Geometry.isBrandRed(120, 90, 90)) // marrom apagado
    }
}
