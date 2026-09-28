<?php
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

use Bitrix\Main\Context;
use Bitrix\Main\Web\Json;
use Bitrix\Catalog\PriceTable;
use FS\APILARA\Api;

header('Content-Type: application/json; charset=UTF-8');
function out($data,$status=200){http_response_code($status);echo Json::encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
if(!CModule::IncludeModule('iblock')||!CModule::IncludeModule('catalog')||!CModule::IncludeModule('currency'))out(['error'=>'modules_unavailable'],503);
$r=Context::getCurrent()->getRequest();$colorId=(int)$r->get('color_id');if($colorId<=0)out(['error'=>'invalid_color'],400);
$color=CIBlockElement::GetList([],['IBLOCK_ID'=>49,'ID'=>$colorId,'ACTIVE'=>'Y'],false,false,['ID','NAME'])->Fetch();if(!$color)out(['error'=>'color_not_found'],404);
function money($n){return (float)round((float)$n,2);}
function priceForTint($parentId,$offerId,$colorId){try{$api=new Api();$api->setData((int)$parentId,(int)$offerId,(int)$colorId);$d=$api->getPrice(true);if(isset($d['status'])&&$d['status']===true&&isset($d['price'])&&(float)$d['price']>0)return (float)$d['price'];}catch(\Throwable $e){AddMessage2Log('Tint price: '.$e->getMessage(),'archipaint.podbor');}return null;}
function elementMeta($id){$f=CIBlockElement::GetByID($id)->Fetch();if(!$f)return null;return ['img'=>!empty($f['PREVIEW_PICTURE'])?CFile::GetPath($f['PREVIEW_PICTURE']):'/local/templates/universelite_s1/images/picture.missing.png','url'=>CIBlock::ReplaceDetailUrl($f['DETAIL_PAGE_URL'],$f,true,'E')];}
function numberFromText($v){if(is_array($v))$v=reset($v);$v=str_replace(',','.',(string)$v);if(preg_match('/(\d+(?:\.\d+)?)/u',$v,$m))return (float)$m[1];return null;}
function litresFromText($v){$raw=mb_strtolower(trim((string)$v));$n=numberFromText($raw);if(!$n)return null;if(strpos($raw,'мл')!==false)return round($n/1000,3);return $n;}
function productFacts($id){
  $facts=['coverage'=>null,'coverage_source'=>null,'line'=>'','sheen'=>'','use'=>''];
  $aliases=['coverage'=>['COVERAGE','RASHOD','RASKHOD','CONSUMPTION','RASHOD_M2_L','RASKHOD_M2_L','UKRYVISTOST'], 'line'=>['LINE','SERIES','COLLECTION'], 'sheen'=>['SHEEN','GLOSS','STEPEN_BLESKA'], 'use'=>['USE','APPLICATION','NAZNACHENIE']];
  $props=[];$pr=CIBlockElement::GetProperty(49,$id,['sort'=>'asc'],[]);while($p=$pr->Fetch()){$props[strtoupper((string)$p['CODE'])]=$p;}
  foreach($aliases['coverage'] as $code){if(!empty($props[$code]['VALUE'])){$n=numberFromText($props[$code]['VALUE']);if($n&&$n>0){$facts['coverage']=$n;$facts['coverage_source']=$code;break;}}}
  foreach(['line','sheen','use'] as $field){foreach($aliases[$field] as $code){if(!empty($props[$code]['VALUE'])){$facts[$field]=is_array($props[$code]['VALUE'])?implode(', ',$props[$code]['VALUE']):(string)$props[$code]['VALUE'];break;}}}
  return $facts;
}
$options=[];
foreach([[37672,'tester','Пробник цвета','Мини-банка краски для выкрасов и теста цвета'],[82767,'paper','Образец на бумаге','Выкрас краски формата А4']] as $x){[$pid,$kind,$title,$desc]=$x;$p=PriceTable::getList(['filter'=>['=PRODUCT_ID'=>$pid,'=CATALOG_GROUP_ID'=>1]])->fetch();if(!$p||(float)$p['PRICE']<=0)continue;$m=elementMeta($pid);if(!$m)continue;$options[]=['id'=>$kind.'_'.$pid,'kind'=>$kind,'bitrix_id'=>$pid,'main_product_id'=>$pid,'title'=>$title,'product_name'=>$title,'desc'=>$desc,'volume'=>'','volume_litres'=>null,'price'=>money($p['PRICE']),'currency'=>'RUB','img'=>$m['img'],'url'=>$m['url']];}
$productIds=[];$parents=[];$res=CIBlockElement::GetList([],['IBLOCK_ID'=>49,'SECTION_ID'=>120,'ACTIVE'=>'Y'],false,false,['ID','NAME','PREVIEW_PICTURE','DETAIL_PAGE_URL']);
while($p=$res->Fetch()){$id=(int)$p['ID'];$productIds[]=$id;$parents[$id]=['name'=>$p['NAME'],'img'=>!empty($p['PREVIEW_PICTURE'])?CFile::GetPath($p['PREVIEW_PICTURE']):'/local/templates/universelite_s1/images/picture.missing.png','url'=>CIBlock::ReplaceDetailUrl($p['DETAIL_PAGE_URL'],$p,true,'E'),'facts'=>productFacts($id)];}
if($productIds){$offers=CIBlockElement::GetList(['PROPERTY_CML2_LINK'=>'ASC','PROPERTY_VOLUME'=>'ASC'],['IBLOCK_ID'=>50,'ACTIVE'=>'Y','PROPERTY_CML2_LINK'=>$productIds],false,false,['ID','NAME','PROPERTY_CML2_LINK','PROPERTY_VOLUME']);while($o=$offers->Fetch()){$parentId=(int)$o['PROPERTY_CML2_LINK_VALUE'];$offerId=(int)$o['ID'];if(!$parentId||!isset($parents[$parentId]))continue;$price=priceForTint($parentId,$offerId,$colorId);if($price===null)continue;$volume=trim((string)$o['PROPERTY_VOLUME_VALUE']);$f=$parents[$parentId]['facts'];$options[]=['id'=>'paint_'.$offerId,'kind'=>'paint','bitrix_id'=>$offerId,'main_product_id'=>$parentId,'title'=>$parents[$parentId]['name'].($volume?' ('.$volume.')':''),'product_name'=>$parents[$parentId]['name'],'product_line'=>$f['line'],'sheen'=>$f['sheen'],'use'=>$f['use'],'coverage'=>$f['coverage'],'coverage_source'=>$f['coverage_source'],'desc'=>'Краска с колеровкой в выбранный цвет','volume'=>$volume,'volume_litres'=>litresFromText($volume),'price'=>money($price),'currency'=>'RUB','img'=>$parents[$parentId]['img'],'url'=>$parents[$parentId]['url']];}}
out(['color'=>['id'=>$colorId,'name'=>$color['NAME']],'options'=>$options]);
